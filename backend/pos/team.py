"""
pos/team.py — Team: employees, roles & permissions, staff mode.

  GET  staff/me/                 who is acting and what they may do
  GET  staff/workers/            names for the "who is using this device" picker
  POST staff/session/            start staff mode (verify the employee's PIN)
  POST staff/session/end/        leave staff mode (owner password or manager PIN)
  GET/POST  roles/               list roles (+ permission catalogue) · create/clone
  PATCH/DELETE roles/<id>/       rename, change permissions · remove
  GET/POST  workers/team/        employees (works without POS enabled)
  PATCH     workers/team/<id>/   name, PIN, role, areas, active

Permission decisions live in pos.rbac; which role may call these endpoints in
staff mode is decided by pos.middleware. Everything is scoped to the acting
merchant.
"""

from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from . import rbac
from .models import PosAuditLog, ShiftWorker, StaffAreaAssignment, StaffRole
from .serializers import CreateWorkerSerializer, TeamShiftWorkerSerializer, UpdateWorkerSerializer


class TeamError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def _merchant(request):
    try:
        return request.user.merchant_profile
    except Exception:
        return None


def _no_merchant():
    return Response({"error": "No merchant profile found for this user."}, status=403)


def _audit(request, merchant, action, entity_type, entity_id, worker=None, **metadata):
    actor = rbac.request_worker(request, merchant)
    if actor is not None:
        metadata.setdefault("by_staff", actor.display_name)
    PosAuditLog.objects.create(
        merchant=merchant, user=request.user, worker=worker, action=action,
        entity_type=entity_type, entity_id=str(entity_id), metadata=metadata,
    )


def _guard_escalation(request, merchant, permissions):
    """An employee can never hand out more access than they have themselves."""
    actor = rbac.request_worker(request, merchant)
    if actor is None:
        return  # the owner is the Admin of their own merchant
    if not set(permissions) <= rbac.worker_permissions(actor):
        raise TeamError("You can't give more access than your own role has.", status=403)


# ── Employees ─────────────────────────────────────────────────────────────────

def resolve_role(request, merchant, data, worker=None):
    """The role named in a create/update payload (or None to leave unchanged)."""
    roles = rbac.ensure_default_roles(merchant)
    role = None
    # 1. Custom permissions specified directly
    if "permissions" in data and isinstance(data["permissions"], list):
        wanted = set(data["permissions"]) & rbac._ALL_SET
        # Check if an existing role for this merchant has these exact permissions
        existing_role = None
        for r in StaffRole.objects.filter(merchant=merchant, is_active=True):
            if rbac.role_permissions(r) == wanted:
                existing_role = r
                break
        if existing_role:
            role = existing_role
        else:
            worker_name = data.get("display_name") or (worker.display_name if worker else "Staff")
            base_name = f"{worker_name} (Role)"[:55]
            role_name = base_name
            suffix = 1
            while StaffRole.objects.filter(merchant=merchant, name=role_name, is_active=True).exists():
                suffix += 1
                role_name = f"{base_name} {suffix}"[:60]
            role = StaffRole.objects.create(
                merchant=merchant,
                name=role_name,
                description=f"Custom permissions for {worker_name}",
            )
            rbac.set_role_permissions(role, wanted)
    elif data.get("staff_role"):
        role = StaffRole.objects.filter(merchant=merchant, id=data["staff_role"], is_active=True).first()
        if role is None:
            raise TeamError("Choose a role.")
    elif data.get("role"):
        # Older clients send the coarse role; map it to the matching default.
        role = roles[rbac.LEGACY_ROLE_MAP[data["role"]]]
        if worker is not None and worker.staff_role_id and worker.role == data["role"]:
            role = None  # unchanged coarse role: keep the employee's current role
    elif worker is None:
        role = roles[rbac.ROLE_CASHIER]
    if role is not None:
        _guard_escalation(request, merchant, rbac.role_permissions(role))
    return role


def apply_role_and_areas(request, worker, role, area_ids):
    """Assign the role and dining areas, with audit entries for changes."""
    from merchants.models import TableArea

    merchant = worker.merchant
    if role is not None and role.id != worker.staff_role_id:
        previous = worker.staff_role.name if worker.staff_role_id else ""
        rbac.assign_role(worker, role)
        _audit(request, merchant, PosAuditLog.ACTION_WORKER_ROLE_CHANGE, "shift_worker", worker.id,
               worker=worker, employee=worker.display_name, from_role=previous, to_role=role.name)
    elif worker.staff_role_id is None:
        rbac.worker_role(worker)

    if area_ids is not None:
        wanted = set(
            TableArea.objects.filter(merchant=merchant, id__in=area_ids).values_list("id", flat=True)
        )
        current = set(worker.area_assignments.values_list("table_area_id", flat=True))
        if wanted != current:
            worker.area_assignments.exclude(table_area_id__in=wanted).delete()
            StaffAreaAssignment.objects.bulk_create(
                [StaffAreaAssignment(worker=worker, table_area_id=a) for a in wanted - current]
            )
            _audit(request, merchant, PosAuditLog.ACTION_WORKER_AREAS_CHANGE, "shift_worker", worker.id,
                   worker=worker, employee=worker.display_name, areas=sorted(wanted))


def _workers_qs(merchant):
    return (
        ShiftWorker.objects.filter(merchant=merchant, is_deleted=False)
        .select_related("staff_role", "merchant")
        .prefetch_related("area_assignments")
        .order_by("-is_active", "display_name")
    )


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def team_workers(request):
    merchant = _merchant(request)
    if merchant is None:
        return _no_merchant()
    rbac.ensure_default_roles(merchant)
    if request.method == "GET":
        qs = _workers_qs(merchant)
        if request.query_params.get("active") == "1":
            qs = qs.filter(is_active=True)
        return Response(TeamShiftWorkerSerializer(qs, many=True).data)

    ser = CreateWorkerSerializer(data=request.data)
    if not ser.is_valid():
        return Response(ser.errors, status=400)
    data = ser.validated_data
    name = data["display_name"].strip()
    if ShiftWorker.objects.filter(merchant=merchant, display_name__iexact=name, is_active=True, is_deleted=False).exists():
        return Response({"error": f"You already have an employee called “{name}”."}, status=400)

    staff_code = data.get("staff_code", "").strip()
    if staff_code:
        if ShiftWorker.objects.filter(merchant=merchant, staff_code__iexact=staff_code, is_deleted=False).exists():
            return Response({"error": f"Staff code “{staff_code}” is already in use."}, status=400)
    else:
        staff_code = ShiftWorker.generate_staff_code(merchant)

    try:
        role = resolve_role(request, merchant, data)
    except TeamError as exc:
        return Response({"error": str(exc)}, status=exc.status)

    with transaction.atomic():
        worker = ShiftWorker(
            merchant=merchant,
            display_name=name,
            staff_code=staff_code,
            phone=data.get("phone", "").strip(),
            email=data.get("email", "").strip(),
            is_active=data.get("is_active", True),
        )
        worker.set_pin(data["pin"])
        worker.save()
        apply_role_and_areas(request, worker, role, data.get("area_ids"))
    _audit(request, merchant, PosAuditLog.ACTION_WORKER_CREATE, "shift_worker", worker.id,
           worker=worker, display_name=worker.display_name, role=worker.staff_role.name, staff_code=staff_code)
    return Response(TeamShiftWorkerSerializer(_workers_qs(merchant).get(pk=worker.pk)).data, status=201)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def team_worker_detail(request, worker_id):
    merchant = _merchant(request)
    if merchant is None:
        return _no_merchant()
    worker = ShiftWorker.objects.filter(merchant=merchant, id=worker_id, is_deleted=False).first()
    if worker is None:
        return Response({"error": "Employee not found."}, status=404)

    if request.method == "DELETE":
        # Guard escalation: cannot delete someone who has higher permissions than caller
        try:
            _guard_escalation(request, merchant, rbac.worker_permissions(worker))
        except TeamError as exc:
            return Response({"error": str(exc)}, status=exc.status)

        # Check if worker has activity (orders, shifts, payments)
        has_orders = worker.orders.exists()
        has_shifts = worker.opened_shifts.exists() or worker.closed_shifts.exists()
        has_payments = worker.payments.exists()

        with transaction.atomic():
            if has_orders or has_shifts or has_payments:
                # Soft delete to preserve historical integrity
                worker.is_active = False
                worker.is_deleted = True
                worker.staff_code = f"DEL-{worker.staff_code}-{worker.id.hex[:6]}"[:30]
                worker.save(update_fields=["is_active", "is_deleted", "staff_code", "updated_at"])
            else:
                worker.delete()

        _audit(request, merchant, PosAuditLog.ACTION_WORKER_DELETE if hasattr(PosAuditLog, 'ACTION_WORKER_DELETE') else "worker.delete",
               "shift_worker", worker_id, employee=worker.display_name)
        return Response(status=204)

    ser = UpdateWorkerSerializer(data=request.data, partial=True)
    if not ser.is_valid():
        return Response(ser.errors, status=400)
    data = dict(ser.validated_data)
    try:
        # Changing someone who has more access than you is also escalation.
        _guard_escalation(request, merchant, rbac.worker_permissions(worker))
        role = resolve_role(request, merchant, data, worker=worker)
    except TeamError as exc:
        return Response({"error": str(exc)}, status=exc.status)

    if "staff_code" in data and data["staff_code"].strip():
        code = data["staff_code"].strip()
        if ShiftWorker.objects.filter(merchant=merchant, staff_code__iexact=code, is_deleted=False).exclude(id=worker.id).exists():
            return Response({"error": f"Staff code “{code}” is already taken."}, status=400)
        worker.staff_code = code

    with transaction.atomic():
        if "display_name" in data:
            worker.display_name = data["display_name"].strip()
        if "phone" in data:
            worker.phone = data["phone"].strip()
        if "email" in data:
            worker.email = data["email"].strip()
        if "is_active" in data:
            worker.is_active = data["is_active"]
        worker.save()
        if data.get("pin"):
            worker.set_pin(data["pin"])
            worker.failed_pin_attempts = 0
            worker.locked_until = None
            worker.save(update_fields=["pin_hash", "pin_plain", "failed_pin_attempts", "locked_until", "updated_at"])
        apply_role_and_areas(request, worker, role, data.get("area_ids"))
    _audit(request, merchant, PosAuditLog.ACTION_WORKER_UPDATE, "shift_worker", worker.id, worker=worker)
    return Response(TeamShiftWorkerSerializer(_workers_qs(merchant).get(pk=worker.pk)).data)


# ── Roles & permissions ───────────────────────────────────────────────────────

def _catalog():
    return [
        {
            "key": key, "label": label,
            "permissions": [{"code": code, "label": name, "hint": hint} for code, name, hint in perms],
        }
        for key, label, perms in rbac.PERMISSION_GROUPS
    ]


def _role_payload(role, employee_count=None):
    perms = sorted(rbac.role_permissions(role))
    return {
        "id": role.id,
        "name": role.name,
        "description": role.description,
        "is_system": role.is_system,
        "is_admin": role.is_admin,
        "is_active": role.is_active,
        "permissions": perms,
        "permission_count": len(perms),
        "employee_count": employee_count if employee_count is not None
        else role.workers.filter(is_active=True).count(),
    }


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def roles(request):
    merchant = _merchant(request)
    if merchant is None:
        return _no_merchant()
    rbac.ensure_default_roles(merchant)

    if request.method == "GET":
        qs = StaffRole.objects.filter(merchant=merchant, is_active=True).annotate(
            n=Count("workers", filter=Q(workers__is_active=True))
        ).prefetch_related("permissions")
        return Response({
            "roles": [_role_payload(r, r.n) for r in qs],
            "permission_groups": _catalog(),
        })

    name = str(request.data.get("name") or "").strip()[:60]
    if not name:
        return Response({"error": "Give the role a name."}, status=400)
    if StaffRole.objects.filter(merchant=merchant, name__iexact=name).exists():
        return Response({"error": f"You already have a role called “{name}”."}, status=400)
    permissions = request.data.get("permissions")
    clone_from = request.data.get("clone_from")
    if permissions is None and clone_from:
        source = StaffRole.objects.filter(merchant=merchant, id=clone_from).first()
        if source is None:
            return Response({"error": "Role to copy was not found."}, status=400)
        permissions = [] if source.is_admin else list(rbac.role_permissions(source))
        if source.is_admin:
            permissions = list(rbac.ALL_PERMISSIONS)
    if not isinstance(permissions, list):
        permissions = []
    permissions = [p for p in permissions if p in rbac.ALL_PERMISSIONS]
    try:
        _guard_escalation(request, merchant, permissions)
    except TeamError as exc:
        return Response({"error": str(exc)}, status=exc.status)
    with transaction.atomic():
        role = StaffRole.objects.create(
            merchant=merchant, name=name,
            description=str(request.data.get("description") or "")[:200],
        )
        rbac.set_role_permissions(role, permissions)
    _audit(request, merchant, PosAuditLog.ACTION_ROLE_CREATE, "staff_role", role.id,
           name=name, permissions=sorted(permissions))
    return Response(_role_payload(role), status=201)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def role_detail(request, pk):
    merchant = _merchant(request)
    if merchant is None:
        return _no_merchant()
    role = StaffRole.objects.filter(merchant=merchant, id=pk, is_active=True).first()
    if role is None:
        return Response({"error": "Role not found."}, status=404)
    if role.is_admin:
        return Response(
            {"error": "The Admin role always has full access and cannot be changed or removed."}, status=400,
        )

    if request.method == "DELETE":
        if role.is_system:
            return Response({"error": "Default roles cannot be removed. You can change what they allow."},
                            status=400)
        in_use = role.workers.filter(is_active=True).count()
        if in_use:
            return Response(
                {"error": f"{in_use} employee(s) still have this role. Give them another role first."},
                status=400,
            )
        if role.workers.exists():
            # Kept for history: former employees still point at it.
            role.is_active = False
            role.name = f"{role.name} (removed {timezone.now():%Y-%m-%d %H:%M})"[:60]
            role.save(update_fields=["is_active", "name", "updated_at"])
        else:
            role.delete()
        _audit(request, merchant, PosAuditLog.ACTION_ROLE_DEACTIVATE, "staff_role", pk, name=role.name)
        return Response(status=204)

    changes = {}
    try:
        if "name" in request.data:
            name = str(request.data.get("name") or "").strip()[:60]
            if not name:
                raise TeamError("Give the role a name.")
            if role.is_system and name != role.name:
                raise TeamError("Default roles keep their name. Create a new role to use another name.")
            if StaffRole.objects.filter(merchant=merchant, name__iexact=name).exclude(pk=role.pk).exists():
                raise TeamError(f"You already have a role called “{name}”.")
            if name != role.name:
                changes["name"] = [role.name, name]
                role.name = name
        if "description" in request.data:
            role.description = str(request.data.get("description") or "")[:200]
        new_perms = None
        if "permissions" in request.data:
            raw = request.data.get("permissions")
            if not isinstance(raw, list):
                raise TeamError("permissions must be a list.")
            new_perms = {p for p in raw if p in rbac.ALL_PERMISSIONS}
            before = set(rbac.role_permissions(role))
            # An employee may only switch on things they are allowed to do.
            _guard_escalation(request, merchant, new_perms - before)
            if new_perms != before:
                changes["added"] = sorted(new_perms - before)
                changes["removed"] = sorted(before - new_perms)
    except TeamError as exc:
        return Response({"error": str(exc)}, status=exc.status)

    with transaction.atomic():
        role.save()
        if new_perms is not None:
            rbac.set_role_permissions(role, new_perms)
    if changes:
        _audit(request, merchant, PosAuditLog.ACTION_ROLE_UPDATE, "staff_role", role.id, role=role.name, **changes)
    return Response(_role_payload(role))


# ── Staff mode ────────────────────────────────────────────────────────────────

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def staff_me(request):
    """Who is acting. The frontend uses this only to tailor what it shows."""
    merchant = _merchant(request)
    if merchant is None:
        return _no_merchant()
    rbac.ensure_default_roles(merchant)
    token = rbac.staff_token_from(request)
    worker = rbac.worker_from_token(token, merchant) if token else None
    if token and worker is None:
        return Response({"detail": "Your staff session has ended. Please sign in again.",
                         "code": "staff_session_ended"}, status=403)
    payload = rbac.permission_payload(worker)
    payload["staff_mode_available"] = ShiftWorker.objects.filter(merchant=merchant, is_active=True).exists()
    payload["business_name"] = merchant.business_name
    return Response(payload)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def staff_workers(request):
    merchant = _merchant(request)
    if merchant is None:
        return _no_merchant()
    workers = ShiftWorker.objects.filter(merchant=merchant, is_active=True, is_deleted=False).select_related("staff_role")
    token = rbac.staff_token_from(request)
    rows = []
    for w in workers.order_by("display_name"):
        role = rbac.worker_role(w)
        can_unlock = role.is_admin or "staff.manage" in rbac.role_permissions(role)
        if token and not can_unlock:
            continue  # in staff mode only people who can unlock are listed
        rows.append({
            "id": str(w.id),
            "name": w.display_name,
            "staff_code": w.staff_code,
            "role_name": role.name,
            "can_unlock": can_unlock,
        })
    return Response(rows)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def staff_session_start(request):
    merchant = _merchant(request)
    if merchant is None:
        return _no_merchant()
    if rbac.staff_token_from(request):
        return Response({"error": "Leave staff mode first."}, status=403)
    worker = None
    if request.data.get("staff_code"):
        code = str(request.data.get("staff_code")).strip()
        worker = ShiftWorker.objects.filter(
            merchant=merchant, staff_code__iexact=code, is_active=True, is_deleted=False
        ).first()
    elif request.data.get("worker_id"):
        try:
            worker = ShiftWorker.objects.filter(
                merchant=merchant, id=request.data.get("worker_id"), is_active=True, is_deleted=False
            ).first()
        except Exception:
            worker = None
    if worker is None:
        return Response({"error": "Staff member not found."}, status=404)
    if not worker.verify_pin(str(request.data.get("pin") or "")):
        if worker.locked_until and worker.locked_until > timezone.now():
            return Response({"error": "Too many wrong PINs. Try again in 15 minutes."}, status=429)
        return Response({"error": "That PIN is not right. Please try again."}, status=401)
    _audit(request, merchant, PosAuditLog.ACTION_STAFF_MODE, "shift_worker", worker.id,
           worker=worker, event="started", employee=worker.display_name)
    return Response({"token": rbac.issue_staff_token(worker), **rbac.permission_payload(worker)})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def staff_session_end(request):
    """Needs the owner password, or the PIN of someone who manages employees."""
    merchant = _merchant(request)
    if merchant is None:
        return _no_merchant()
    password = request.data.get("password")
    if password:
        if request.user.check_password(str(password)):
            return Response({"ok": True})
        return Response({"error": "That password is not right."}, status=401)
    worker_id, pin = request.data.get("worker_id"), request.data.get("pin")
    if worker_id and pin:
        try:
            worker = ShiftWorker.objects.filter(merchant=merchant, id=worker_id, is_active=True).first()
        except Exception:
            worker = None
        if worker is not None:
            role = rbac.worker_role(worker)
            if (role.is_admin or "staff.manage" in rbac.role_permissions(role)) and worker.verify_pin(str(pin)):
                return Response({"ok": True})
        return Response({"error": "A manager or admin PIN is needed."}, status=401)
    return Response({"error": "Enter the owner password or a manager PIN."}, status=400)
