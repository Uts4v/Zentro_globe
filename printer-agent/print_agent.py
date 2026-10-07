#!/usr/bin/env python3
"""Zentro Print Bridge — prints ESC/POS jobs from the web app without a dialog.

The browser cannot pick a specific printer silently, so the POS terminal runs
this small local agent. The Zentro web app POSTs raw ESC/POS bytes here and
this script forwards them to the printer the app asked for:

  * connection "network" — raw TCP to <address>:9100 (the standard raw port
    on ESC/POS thermal printers, e.g. 192.168.1.50)
  * connection "usb"     — through the OS print spooler using the printer's
    installed name (Windows: Win32 raw printing via ctypes; Linux/macOS:
    CUPS `lp -o raw`), or a direct device path such as /dev/usb/lp0

It binds to 127.0.0.1 only — nothing outside this machine can reach it.

Usage:
    python printer-agent/print_agent.py [--port 8950]

Start with the rest of the dev stack via `npm run dev:print-agent`.

Standard library only — no pip installs required.
"""

import argparse
import base64
import ipaddress
import json
import os
import platform
import re
import socket
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_JOB_BYTES = 8 * 1024 * 1024  # refuse jobs larger than 8 MB
DEFAULT_NETWORK_PORT = 9100
DEFAULT_TIMEOUT = 15.0

_log_path = None


def _log_file():
    """Agent log under %LOCALAPPDATA%\\ZentroPrintAgent\\. Safe when the agent
    runs as a window-less (--noconsole) executable with no stdout/stderr."""
    global _log_path
    if _log_path is None:
        try:
            base = os.environ.get(
                "LOCALAPPDATA", os.path.expanduser("~")
            )
            log_dir = os.path.join(base, "ZentroPrintAgent")
            os.makedirs(log_dir, exist_ok=True)
            _log_path = os.path.join(log_dir, "agent.log")
        except Exception:
            _log_path = ""
    return _log_path


def log(msg):
    """Write a line to the agent log, and to stdout when one is available."""
    stamp = time.strftime("%H:%M:%S")
    try:
        if sys.stdout is not None:
            sys.stdout.write("[print-agent] %s\n" % msg)
            sys.stdout.flush()
    except Exception:
        pass
    path = _log_file()
    if not path:
        return
    try:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write("%s %s\n" % (stamp, msg))
    except Exception:
        pass


def list_os_printers():
    """Printer names installed on this machine, to help fill in USB targets."""
    system = platform.system()
    try:
        if system == "Windows":
            return _windows_list_printers()
        out = subprocess.run(
            ["lpstat", "-p"], capture_output=True, text=True, timeout=5, check=False
        )
        names = []
        for line in out.stdout.splitlines():
            if line.startswith("printer "):
                names.append(line.split(" ", 1)[1].split(" ")[0].strip())
        return names
    except Exception:
        return []


def _windows_list_printers():
    import ctypes
    from ctypes import wintypes

    winspool = ctypes.WinDLL("winspool.drv")

    class PRINTER_INFO_1(ctypes.Structure):
        _fields_ = [
            ("Flags", wintypes.DWORD),
            ("pDescription", wintypes.LPWSTR),
            ("pName", wintypes.LPWSTR),
            ("pComment", wintypes.LPWSTR),
        ]

    PRINTER_ENUM_LOCAL = 0x00000002
    PRINTER_ENUM_CONNECTIONS = 0x00000004

    buf = wintypes.DWORD()
    count = wintypes.DWORD()
    winspool.EnumPrintersW(
        PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS, None, 1, None, 0, ctypes.byref(buf), ctypes.byref(count)
    )
    if buf.value == 0:
        return []
    raw = ctypes.create_string_buffer(buf.value)
    if not winspool.EnumPrintersW(
        PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS, None, 1, raw, buf.value, ctypes.byref(buf), ctypes.byref(count)
    ):
        return []
    infos = ctypes.cast(
        raw, ctypes.POINTER(PRINTER_INFO_1)
    )
    return [infos[i].pName for i in range(count.value)]


def print_network(address, data, timeout=DEFAULT_TIMEOUT):
    """Send raw bytes to a network thermal printer over TCP (port 9100)."""
    host = address.strip()
    port = DEFAULT_NETWORK_PORT
    if ":" in host and host.rsplit(":", 1)[1].isdigit():
        host, port_s = host.rsplit(":", 1)
        port = int(port_s)
    with socket.create_connection((host, port), timeout=timeout) as sock:
        sock.sendall(data)
        # Give slow printers a moment to pull the last of the buffer.
        try:
            sock.settimeout(2)
            sock.recv(1)
        except OSError:
            pass
    return f"sent {len(data)} bytes to {host}:{port}"


def print_usb(address, data, timeout=DEFAULT_TIMEOUT):
    """Print through the OS: a spooler printer name, or a raw device path."""
    target = address.strip()
    system = platform.system()

    if target.startswith("/"):
        # Direct device, e.g. /dev/usb/lp0 (Linux).
        with open(target, "wb") as dev:
            dev.write(data)
        return f"sent {len(data)} bytes to {target}"

    if system == "Windows":
        _windows_raw_print(target, data, timeout)
        return f"sent {len(data)} bytes to Windows printer '{target}'"

    # Linux / macOS: CUPS. `raw` stops the driver from re-interpreting ESC/POS.
    proc = subprocess.run(
        ["lp", "-d", target, "-o", "raw"],
        input=data,
        capture_output=True,
        timeout=timeout,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.decode(errors="replace").strip() or "lp failed")
    return f"queued {len(data)} bytes to CUPS printer '{target}'"


def _windows_raw_print(printer_name, data, timeout_ms=15000):
    """Write raw bytes to a Windows printer via the winspool API (ctypes)."""
    import ctypes
    from ctypes import wintypes

    winspool = ctypes.WinDLL("winspool.drv", use_last_error=True)

    class DOC_INFO_1(ctypes.Structure):
        _fields_ = [
            ("pDocName", wintypes.LPWSTR),
            ("pOutputFile", wintypes.LPWSTR),
            ("pDataType", wintypes.LPWSTR),
        ]

    handle = wintypes.HANDLE()
    if not winspool.OpenPrinterW(printer_name, ctypes.byref(handle), None):
        raise ctypes.WinError(ctypes.get_last_error())

    try:
        doc = DOC_INFO_1("Zentro Print Job", None, "RAW")
        doc_id = wintypes.DWORD()
        if not winspool.StartDocPrinterW(handle, 1, ctypes.byref(doc)):
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            if not winspool.StartPagePrinter(handle):
                raise ctypes.WinError(ctypes.get_last_error())
            try:
                written = wintypes.DWORD()
                buf = ctypes.create_string_buffer(data, len(data))
                if not winspool.WritePrinter(handle, buf, len(data), ctypes.byref(written)):
                    raise ctypes.WinError(ctypes.get_last_error())
            finally:
                winspool.EndPagePrinter(handle)
        finally:
            winspool.EndDocPrinter(handle)
    finally:
        winspool.ClosePrinter(handle)


def _run_powershell(script):
    """Run a PowerShell snippet and return stdout (UTF-16-safe via EncodedCommand)."""
    encoded = base64.b64encode(script.encode("utf-16-le")).decode("ascii")
    proc = subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
        capture_output=True,
        timeout=20,
        check=False,
    )
    if proc.returncode != 0:
        stdout = proc.stdout.decode("utf-8", errors="replace")
        for line in stdout.splitlines():
            if line.startswith("ERROR:"):
                raise RuntimeError(line[len("ERROR:"):].strip())
        raise RuntimeError(
            proc.stderr.decode(errors="replace").strip() or "powershell command failed"
        )
    return proc.stdout.decode("utf-8", errors="replace")


def _as_list(parsed):
    if not parsed:
        return []
    return parsed if isinstance(parsed, list) else [parsed]


def _windows_installed_printers():
    """Installed print queues with their port and driver."""
    if platform.system() != "Windows":
        return []
    try:
        out = _run_powershell(
            "Get-Printer | Select-Object Name,PortName,DriverName | ConvertTo-Json -Compress"
        )
        rows = _as_list(json.loads(out or "[]"))
        return [
            {
                "name": r.get("Name") or "",
                "port": r.get("PortName") or "",
                "driver": r.get("DriverName") or "",
            }
            for r in rows
            if r.get("Name")
        ]
    except Exception:
        return []


_PS_DEVICE_SCAN = """
$devices = Get-CimInstance Win32_PnPEntity | Where-Object {
  $_.PNPClass -eq 'Printer' -or
  ($_.HardwareID -join ' ') -match 'USBPRINT' -or
  ($_.CompatibleIDs -join ' ') -match 'CLASS_07' -or
  ($_.DeviceID -match '^BTHENUM' -and $_.Name -match 'print')
}
$devices | Select-Object Name, Status, DeviceID | ConvertTo-Json -Compress
"""

# Safe queue names/drivers/ports — also blocks PowerShell injection.
_SAFE_FIELD = re.compile(r"^[A-Za-z0-9 _().\-#\\:]+$")


def list_printer_devices():
    """
    Printer hardware this PC can see, each mapped to its print queue.

    Two identical USB printers can be plugged in and working at the hardware
    level while only one of them has a Windows print queue — jobs can only go
    to a queue, so the missing one shows up here with queue=None and the app
    can offer to install it.
    """
    if platform.system() == "Windows":
        try:
            rows = _as_list(json.loads(_run_powershell(_PS_DEVICE_SCAN) or "[]"))
        except Exception:
            rows = []
        queues = _windows_installed_printers()
        devices = []
        for row in rows:
            device_id = row.get("DeviceID") or ""
            port = None
            match = re.search(r"&(USB\d+)$", device_id)
            if match:
                port = match.group(1)
            queue = next(
                (q["name"] for q in queues if port and q["port"] == port), None
            )
            # Bluetooth printers pair over a virtual COM port — flag them so the
            # app can show them in their own group (they still print via a queue).
            queue_port = next(
                (q["port"] for q in queues if queue and q["name"] == queue), ""
            )
            bluetooth = bool(
                re.search(r"BTHENUM|BTH\\", device_id, re.IGNORECASE)
                or re.match(r"^COM\d+$", queue_port, re.IGNORECASE)
            )
            devices.append(
                {
                    "name": row.get("Name") or "Unknown printer",
                    "status": row.get("Status") or "",
                    "port": port,
                    "queue": queue,
                    "bluetooth": bluetooth,
                }
            )
        return devices

    # Linux / macOS: CUPS device list, best effort.
    try:
        proc = subprocess.run(
            ["lpstat", "-v"], capture_output=True, text=True, timeout=5, check=False
        )
        devices = []
        for line in proc.stdout.splitlines():
            if "device for " not in line:
                continue
            name = line.split("device for ", 1)[1].split(":")[0].strip()
            uri = line.rsplit(": ", 1)[-1]
            devices.append(
                {"name": name, "status": "OK", "port": uri, "queue": name,
                 "bluetooth": uri.startswith("bluetooth://")}
            )
        return devices
    except Exception:
        return []


# ESC/POS "transmit printer status" — a real printer answers, a random open
# port does not. Lets the scan distinguish printers from other port-9100 boxes.
_ESCPOS_STATUS_REQUEST = b"\x10\x04\x01"

_SCAN_PORT = DEFAULT_NETWORK_PORT
_SCAN_TIMEOUT = 0.4
_SCAN_PROBE_TIMEOUT = 0.6
_SCAN_WORKERS = 200
_MAX_SCAN_HOSTS = 4096  # never probe wider than a /20 worth of addresses
_MIN_SCAN_PREFIX = 20


def _local_subnets():
    """IPv4 networks this machine is actually on — private ranges only."""
    system = platform.system()
    rows = []
    try:
        if system == "Windows":
            out = _run_powershell(
                "Get-NetIPAddress -AddressFamily IPv4 | "
                "Select-Object IPAddress,PrefixLength | ConvertTo-Json -Compress"
            )
            rows = _as_list(json.loads(out or "[]"))
            pairs = [
                (r.get("IPAddress"), int(r.get("PrefixLength") or 32))
                for r in rows
                if r.get("IPAddress")
            ]
        else:
            proc = subprocess.run(
                ["ip", "-j", "addr", "show", "scope", "global"],
                capture_output=True,
                text=True,
                timeout=5,
                check=False,
            )
            pairs = []
            for iface in json.loads(proc.stdout or "[]"):
                for info in iface.get("addr_info", []):
                    if info.get("family") == "inet" and info.get("local"):
                        pairs.append((info["local"], int(info.get("prefixlen") or 32)))
    except Exception:
        pairs = []

    subnets = []
    for ip_s, prefix in pairs:
        try:
            net = ipaddress.ip_network(f"{ip_s}/{prefix}", strict=False)
        except ValueError:
            continue
        # Private LANs only — never scan loopback, link-local, or public space.
        if (
            not net.is_private
            or net.is_loopback
            or net.is_link_local
            or net.prefixlen < _MIN_SCAN_PREFIX
        ):
            continue
        subnets.append(net)
    # De-duplicate overlapping/identical subnets.
    return list({str(n): n for n in subnets}.values())


def _scan_host(ip):
    """Connect to port 9100 and, if it answers, ask if it speaks ESC/POS."""
    started = time.monotonic()
    try:
        sock = socket.create_connection((str(ip), _SCAN_PORT), timeout=_SCAN_TIMEOUT)
    except OSError:
        return None
    latency_ms = round((time.monotonic() - started) * 1000, 1)
    escpos = False
    try:
        sock.settimeout(_SCAN_PROBE_TIMEOUT)
        sock.sendall(_ESCPOS_STATUS_REQUEST)
        # Real ESC/POS printers reply with DLE STX ... (0x10 0x02 ...).
        reply = sock.recv(16)
        escpos = len(reply) >= 2 and reply[0] == 0x10 and reply[1] == 0x02
    except OSError:
        pass
    finally:
        sock.close()
    return {"ip": str(ip), "port": _SCAN_PORT, "escpos": escpos, "latency_ms": latency_ms}


def scan_network():
    """Open port-9100 hosts on this machine's private subnets, fastest first."""
    subnets = _local_subnets()
    if not subnets:
        raise RuntimeError("could not determine local network subnets")
    hosts = []
    for net in subnets:
        for host in net.hosts():
            hosts.append(host)
            if len(hosts) >= _MAX_SCAN_HOSTS:
                break
        if len(hosts) >= _MAX_SCAN_HOSTS:
            break
    hits = []
    with ThreadPoolExecutor(max_workers=_SCAN_WORKERS) as pool:
        for hit in pool.map(_scan_host, hosts):
            if hit is not None:
                hits.append(hit)
    hits.sort(key=lambda h: h["latency_ms"])
    return {"hosts": hits, "scanned": len(hosts), "subnets": [str(n) for n in subnets]}


def install_printer(payload):
    """Create a Windows print queue for a detected device that lacks one."""
    name = (payload.get("name") or "").strip()
    port = (payload.get("port") or "").strip()
    driver = (payload.get("driver_name") or "").strip()

    if not name or not port:
        raise ValueError("missing queue name or port")
    for field in (name, port, driver):
        if field and not _SAFE_FIELD.match(field):
            raise ValueError(f"invalid characters in '{field}'")

    if platform.system() != "Windows":
        raise RuntimeError("queue installation is only supported on Windows")

    if not driver:
        # Same model on the desk: reuse the driver of an existing queue.
        existing = _windows_installed_printers()
        if not existing:
            raise RuntimeError(
                "no installed printer driver to reuse - add the printer manually "
                "in Windows Settings > Printers & scanners"
            )
        driver = existing[0]["driver"]

    script = (
        "$ErrorActionPreference = 'Stop'; "
        "try { "
        f"Add-Printer -Name '{name}' -DriverName '{driver}' -PortName '{port}'; "
        "Get-Printer -Name "
        f"'{name}' | Select-Object Name,PortName,DriverName | ConvertTo-Json -Compress "
        "} catch { Write-Output ('ERROR:' + $_.Exception.Message); exit 1 }"
    )
    out = _run_powershell(script).strip()
    row = json.loads(out) if out else {}
    return {
        "name": row.get("Name") or name,
        "port": row.get("PortName") or port,
        "driver": row.get("DriverName") or driver,
    }


def run_job(payload):
    connection = payload.get("connection")
    address = payload.get("address") or ""
    data = base64.b64decode(payload.get("data") or "")
    copies = max(1, min(int(payload.get("copies") or 1), 10))
    timeout = float(payload.get("timeout") or DEFAULT_TIMEOUT)

    if not data:
        raise ValueError("empty print data")
    if not address:
        raise ValueError("missing printer address")
    if len(data) > MAX_JOB_BYTES:
        raise ValueError("print job too large")

    results = []
    for _ in range(copies):
        if connection == "network":
            results.append(print_network(address, data, timeout))
        elif connection == "usb":
            results.append(print_usb(address, data, timeout))
        else:
            raise ValueError(f"unknown connection type '{connection}'")
    return results


class Handler(BaseHTTPRequestHandler):
    server_version = "ZentroPrintBridge/1.0"

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send_json(204, {})

    def do_GET(self):
        if self.path in ("/", "/health"):
            self._send_json(
                200,
                {
                    "ok": True,
                    "agent": "zentro-print-bridge",
                    "version": "1.0",
                    "platform": platform.system().lower(),
                },
            )
        elif self.path == "/printers":
            self._send_json(200, {"printers": list_os_printers()})
        elif self.path == "/devices":
            self._send_json(200, {"devices": list_printer_devices()})
        elif self.path == "/scan-network":
            try:
                self._send_json(200, {"ok": True, **scan_network()})
            except Exception as exc:  # noqa: BLE001
                self._send_json(500, {"ok": False, "error": str(exc)})
        else:
            self._send_json(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        if self.path == "/install-printer":
            try:
                length = int(self.headers.get("Content-Length") or 0)
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
                queue = install_printer(payload)
                self._send_json(200, {"ok": True, "queue": queue})
            except Exception as exc:  # noqa: BLE001
                self._send_json(500, {"ok": False, "error": str(exc)})
            return
        if self.path != "/print":
            self._send_json(404, {"ok": False, "error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > MAX_JOB_BYTES * 2:
                raise ValueError("bad content length")
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            results = run_job(payload)
            self._send_json(200, {"ok": True, "results": results})
        except Exception as exc:  # noqa: BLE001 — every failure becomes a JSON error
            self._send_json(500, {"ok": False, "error": str(exc)})

    def log_message(self, fmt, *args):
        # One line per request — enough to debug, not a per-print flood.
        log("%s - %s" % (self.address_string(), fmt % args))


def main():
    parser = argparse.ArgumentParser(description="Zentro local print bridge")
    parser.add_argument("--port", type=int, default=8950)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    log(f"Zentro Print Bridge listening on http://{args.host}:{args.port}")
    log("Endpoints: GET /health, GET /printers, GET /devices, GET /scan-network, POST /print, POST /install-printer")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("stopped")


if __name__ == "__main__":
    main()
