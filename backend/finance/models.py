"""
finance/models.py — the merchant's Accounts section.

Sales money is never re-entered here: it is read from the POS payment records
(pos.PosPayment, pos.PosCashMovement). This app stores only what the POS does
not know about:

  * MoneyEntry    — money the merchant records by hand: expenses, supplier
                    payments, salary payments, other income and transfers
                    between the cash drawer and the bank.
  * StaffSalary   — what an employee is owed for a month; salary payments are
                    MoneyEntry rows pointing at it.
  * FinanceSettings — opening cash and bank balances.

Money records are history. A MoneyEntry is never edited or deleted: a mistake
is voided (who, when, why) and entered again.
"""

from decimal import Decimal

from django.conf import settings
from django.db import models
from django.utils import timezone

ZERO = Decimal("0")


class FinanceSettings(models.Model):
    merchant = models.OneToOneField(
        "merchants.MerchantProfile", on_delete=models.CASCADE, related_name="finance_settings",
    )
    opening_cash = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    opening_bank = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    opening_date = models.DateField(
        null=True, blank=True,
        help_text="Balances count money from this day on. Empty = from the first record.",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "finance_settings"

    @classmethod
    def for_merchant(cls, merchant):
        obj, _ = cls.objects.get_or_create(merchant=merchant)
        return obj


class StaffSalary(models.Model):
    """What one employee is owed for one month."""

    merchant = models.ForeignKey(
        "merchants.MerchantProfile", on_delete=models.CASCADE, related_name="staff_salaries",
    )
    worker = models.ForeignKey(
        "pos.ShiftWorker", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="salaries",
    )
    worker_name = models.CharField(max_length=120, help_text="Name at the time, kept if the employee is removed.")
    period = models.DateField(help_text="First day of the month this salary is for.")
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    note = models.CharField(max_length=255, blank=True, default="")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
    )
    created_by_name = models.CharField(max_length=120, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "finance_staff_salaries"
        ordering = ["-period", "worker_name"]
        constraints = [
            models.UniqueConstraint(
                fields=["merchant", "worker", "period"],
                condition=models.Q(worker__isnull=False),
                name="uniq_staff_salary_per_month",
            ),
        ]

    def __str__(self):
        return f"{self.worker_name} {self.period:%b %Y}: {self.amount}"


class MoneyEntry(models.Model):
    KIND_EXPENSE = "expense"
    KIND_SUPPLIER_PAYMENT = "supplier_payment"
    KIND_SALARY_PAYMENT = "salary_payment"
    KIND_OTHER_INCOME = "other_income"
    KIND_BANK_DEPOSIT = "bank_deposit"        # cash drawer -> bank
    KIND_BANK_WITHDRAWAL = "bank_withdrawal"  # bank -> cash drawer

    KIND_CHOICES = [
        (KIND_EXPENSE, "Expense"),
        (KIND_SUPPLIER_PAYMENT, "Supplier payment"),
        (KIND_SALARY_PAYMENT, "Salary payment"),
        (KIND_OTHER_INCOME, "Other income"),
        (KIND_BANK_DEPOSIT, "Cash put in the bank"),
        (KIND_BANK_WITHDRAWAL, "Cash taken from the bank"),
    ]
    TRANSFER_KINDS = (KIND_BANK_DEPOSIT, KIND_BANK_WITHDRAWAL)
    OUT_KINDS = (KIND_EXPENSE, KIND_SUPPLIER_PAYMENT, KIND_SALARY_PAYMENT)

    METHOD_CASH = "cash"
    METHOD_BANK = "bank_transfer"
    METHOD_ONLINE = "online"
    METHOD_CHEQUE = "cheque"
    METHOD_OTHER = "other"
    METHOD_CHOICES = [
        (METHOD_CASH, "Cash"),
        (METHOD_BANK, "Bank transfer"),
        (METHOD_ONLINE, "Online / wallet"),
        (METHOD_CHEQUE, "Cheque"),
        (METHOD_OTHER, "Other"),
    ]

    ACCOUNT_CASH = "cash"
    ACCOUNT_BANK = "bank"

    EXPENSE_CATEGORIES = [
        ("rent", "Rent"),
        ("utilities", "Electricity, water, internet"),
        ("supplies", "Supplies"),
        ("maintenance", "Repairs and maintenance"),
        ("transport", "Transport"),
        ("marketing", "Marketing"),
        ("tax", "Tax and fees"),
        ("other", "Other"),
    ]

    merchant = models.ForeignKey(
        "merchants.MerchantProfile", on_delete=models.CASCADE, related_name="money_entries",
    )
    kind = models.CharField(max_length=24, choices=KIND_CHOICES, db_index=True)
    amount = models.DecimalField(max_digits=14, decimal_places=2, help_text="Always positive.")
    payment_method = models.CharField(max_length=20, choices=METHOD_CHOICES, default=METHOD_CASH)
    date = models.DateField(default=timezone.localdate, db_index=True)
    category = models.CharField(max_length=24, blank=True, default="")
    reference = models.CharField(max_length=120, blank=True, default="")
    note = models.CharField(max_length=255, blank=True, default="")

    supplier = models.ForeignKey(
        "inventory.Supplier", on_delete=models.PROTECT, null=True, blank=True,
        related_name="money_entries",
    )
    receiving = models.ForeignKey(
        "inventory.InventoryReceiving", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="money_entries",
        help_text="The delivery this supplier payment is for, when the merchant picked one.",
    )
    salary = models.ForeignKey(
        StaffSalary, on_delete=models.PROTECT, null=True, blank=True, related_name="payments",
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
    )
    created_by_name = models.CharField(max_length=120, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    client_key = models.CharField(
        max_length=64, blank=True, default="",
        help_text="Sent by the form so a double tap or retry never records the money twice.",
    )

    is_void = models.BooleanField(default=False, db_index=True)
    voided_at = models.DateTimeField(null=True, blank=True)
    voided_by_name = models.CharField(max_length=120, blank=True, default="")
    void_reason = models.CharField(max_length=255, blank=True, default="")

    class Meta:
        db_table = "finance_money_entries"
        ordering = ["-date", "-id"]
        indexes = [
            models.Index(fields=["merchant", "date"], name="fin_entry_merchant_date_idx"),
            models.Index(fields=["merchant", "kind", "date"], name="fin_entry_kind_date_idx"),
        ]
        constraints = [
            models.CheckConstraint(condition=models.Q(amount__gt=0), name="fin_entry_amount_positive"),
            models.UniqueConstraint(
                fields=["merchant", "client_key"],
                condition=~models.Q(client_key=""),
                name="uniq_fin_entry_client_key",
            ),
        ]

    @property
    def account(self) -> str:
        """Which pot the payment method moves: the cash drawer or the bank."""
        return self.ACCOUNT_CASH if self.payment_method == self.METHOD_CASH else self.ACCOUNT_BANK

    def __str__(self):
        return f"{self.get_kind_display()} {self.amount} on {self.date}"
