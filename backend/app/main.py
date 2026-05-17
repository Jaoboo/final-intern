from contextlib import asynccontextmanager
from datetime import date, datetime, time
import traceback
from typing import Optional

from fastapi import FastAPI, HTTPException, BackgroundTasks, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .database.database import init_db, load_csv_to_db, SessionLocal, Model, DefectMode, parse_model_qr, CorrectionNote
from .cache import init_duckdb, sync_all, sync_volume, sync_defect, sync_report, sync_tsd_expense
from .database.system import (
    get_all_models, get_all_employees, get_all_defect_modes,
    insert_volume, insert_defect, insert_report,
    record_volume, record_defect, record_report,
    del_volume, del_defect, del_report,
    filter_volume, filter_defect, filter_report,
)
from .analyze import (
    get_daily_monitoring, get_daily_trend_combined, get_data_table_summary,
    get_analyze, get_daily_ratio, get_breakdown,
    get_daily_trend, get_tsd_summary
)
from .schemas import FormDefectBody, FormVolumeBody, VolumeFormInsert, DefectFormInsert, ReportFormInsert, TSDExpenseInsert
from pydantic import BaseModel

from .routers import auth as auth_router, users as users_router


# ─── WebSocket Connection Manager ─────────────────────────────────── #

class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, data: dict):
        import json
        dead = []
        for ws in self.active:
            try:
                await ws.send_text(json.dumps(data))
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

ws_manager = ConnectionManager()

# ─── Lifespan ─────────────────────────────────────────────────────── #
@asynccontextmanager
async def lifespan(app: FastAPI):
    import threading
    init_db()
    load_csv_to_db()
    init_duckdb()
    # sync_all รันใน background thread — server พร้อมรับ request ได้ทันที
    # analyze endpoints จะ return ข้อมูลว่างชั่วคราวจนกว่า sync จะเสร็จ
    threading.Thread(target=sync_all, daemon=True, name="cache-sync").start()
    yield

app = FastAPI(lifespan=lifespan)

@app.exception_handler(Exception)
async def debug_handler(request: Request, exc: Exception):
    return JSONResponse(status_code=500, content={"error": traceback.format_exc()})

import os

# ── CORS ────────────────────────────────────────────────────────────
# กำหนด ALLOWED_ORIGINS ใน .env เช่น:
#   ALLOWED_ORIGINS=http://localhost:3000,http://10.147.155.27:3000
# ถ้าไม่กำหนดจะ allow ทุก origin (สำหรับ dev เท่านั้น)
_raw_origins = os.getenv("ALLOWED_ORIGINS", "")
_ORIGINS: list[str] | str = (
    [o.strip() for o in _raw_origins.split(",") if o.strip()]
    if _raw_origins
    else ["*"]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ORIGINS,
    allow_credentials=_ORIGINS != ["*"],   # credentials ใช้ร่วมกับ wildcard ไม่ได้
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Routers ──────────────────────────────────────────────────────── #
app.include_router(auth_router.router)
app.include_router(users_router.router)

# ─── WebSocket Endpoint ───────────────────────────────────────────── #
@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    """
    Client เชื่อมต่อแล้วรอรับ event:
    - {"type": "defect_inserted", "inserted": N, "date": "YYYY-MM-DD"}  — เมื่อมีการบันทึก defect
    - {"type": "ping"}  — heartbeat จาก server ทุก 30 วิ
    - {"type": "pong"}  — client ตอบ
    """
    import asyncio
    await ws_manager.connect(ws)
    try:
        while True:
            # wait for any message from client (pong / keep-alive)
            await asyncio.wait_for(ws.receive_text(), timeout=60)
    except (WebSocketDisconnect, asyncio.TimeoutError, Exception):
        ws_manager.disconnect(ws)

# ─── Master Data ──────────────────────────────────────────────────── #
@app.get("/models")
def api_get_models():
    return get_all_models()

@app.get("/employees")
def api_get_employees():
    return get_all_employees()

@app.get("/defect-modes")
def api_get_defect_modes():
    return get_all_defect_modes()

# ─── Options (dropdown lists) ─────────────────────────────────────── #
@app.get("/options/employees")
def api_options_employees(format: Optional[str] = "name"):
    """
    format=name  → คืน list of string (ชื่อ) — default เดิม
    format=full  → คืน list of object { work_number, name, full_name, department, position, role }
    """
    db = SessionLocal()
    try:
        from .database.database import Employee
        rows = db.query(Employee).filter(Employee.is_active == True).order_by(Employee.name).all()
        if format == "full":
            return [
                {
                    "work_number": r.work_number,
                    "name":        r.name or "",
                    "full_name":   getattr(r, "full_name", None) or r.name or "",
                    "department":  getattr(r, "department", "") or "",
                    "position":    getattr(r, "position", "") or "",
                    "role":        str(r.role.value if hasattr(r.role, "value") else r.role),
                }
                for r in rows
            ]
        # default: list of name strings (backward compat)
        return [r.name for r in rows if r.name]
    finally:
        db.close()

@app.get("/options/models")
def api_opt_models():
    db = SessionLocal()
    try:
        rows = db.query(Model).order_by(Model.model_name).all()
        return sorted(set(r.model_name for r in rows if r.model_name))
    finally:
        db.close()

@app.get("/options/lines")
def api_opt_lines():
    from .cache import get_read_con
    cur = get_read_con()
    rows = cur.execute("SELECT DISTINCT line FROM defect WHERE line IS NOT NULL AND line != '' ORDER BY line").fetchall()
    vals = [r[0] for r in rows]
    return sorted(vals, key=lambda x: (not x.isdigit(), int(x) if x.isdigit() else x))

@app.get("/options/corenos")
def api_opt_corenos():
    from .cache import get_read_con
    cur = get_read_con()
    rows = cur.execute("SELECT DISTINCT core_no FROM defect WHERE core_no IS NOT NULL AND core_no != '' ORDER BY core_no").fetchall()
    vals = [r[0] for r in rows]
    return sorted(vals, key=lambda x: (not x.isdigit(), int(x) if x.isdigit() else x))

@app.get("/master/models")
def api_master_models():
    db = SessionLocal()
    try:
        rows = db.query(Model).order_by(Model.model_name).all()
        return [r.model_name for r in rows]
    finally:
        db.close()

@app.get("/options/names")
def api_opt_names():
    from .cache import get_read_con
    cur = get_read_con()
    rows = cur.execute("SELECT DISTINCT name FROM defect WHERE name IS NOT NULL AND name != '' ORDER BY name").fetchall()
    return [r[0] for r in rows]

@app.get("/options/defect-modes")
def api_opt_defect_modes():
    from .cache import get_read_con
    cur = get_read_con()
    rows = cur.execute("SELECT DISTINCT defect_mode FROM defect WHERE defect_mode IS NOT NULL AND defect_mode != '' ORDER BY defect_mode").fetchall()
    return [r[0] for r in rows]

@app.get("/options/models")
def api_opt_models_from_defect():
    # model options จาก defect records (ตัวที่ถูกใช้จริงในการผลิต)
    data = record_defect()
    return sorted(set(r["model_name"] for r in data if r.get("model_name")))

# ─── Lookup ───────────────────────────────────────────────────────── #
@app.get("/lookup/qr/{qr_code}")
def api_lookup_qr(qr_code: str):
    if len(qr_code) < 28:
        raise HTTPException(status_code=400, detail="QR code too short")
    parsed = parse_model_qr(qr_code)
    db = SessionLocal()
    try:
        model = db.query(Model).filter(Model.part_no == parsed["part_no"]).first()
        if not model:
            raise HTTPException(status_code=404, detail=f"ไม่พบ part_no: {parsed['part_no']}")
        return {
            "part_no":          model.part_no,
            "model":            model.model_name,
            "line":             parsed["line"],
            "core_no":          parsed["core_no"],
            "date":             parsed["prod_date"],
            "time":             parsed["prod_time"],
            "work_tag":         parsed["work_tag"],
            "ph_top":           model.ph_top or "",
            "die_list_ph_top":  model.die_list_ph_top or "F",
            "ph_btm":           model.ph_btm or "",
            "die_list_ph_btm":  model.die_list_ph_btm or "F",
            "th_top":           model.th_top or "",
            "th_btm":           model.th_btm or "",
        }
    finally:
        db.close()

@app.get("/lookup/defect/{defect_item}")
def api_lookup_defect(defect_item: str):
    db = SessionLocal()
    try:
        dm = db.query(DefectMode).filter(DefectMode.defect_item == defect_item).first()
        if not dm:
            raise HTTPException(status_code=404, detail=f"ไม่พบ defect item: {defect_item}")
        return {
            "defect_item":       dm.defect_item,
            "defect_mode":       dm.defect_mode or "",
            "defect_code":       dm.defect_code or "",
            "defect_by_process": dm.defect_by_process or "",
            "defect_type":       dm.defect_type or "",
        }
    finally:
        db.close()

@app.post("/form/defect")
async def api_form_defect(body: FormDefectBody, bg: BackgroundTasks):
    data = DefectFormInsert(
        d_name      = body.name,
        d_shift     = body.shift,
        d_qr_model  = body.model_qr if isinstance(body.model_qr, list) else [body.model_qr],
        d_qr_defect = body.defect_qr,
    )
    result = insert_defect(data)
    bg.add_task(sync_defect)
    # ── Broadcast to all Dashboard WebSocket clients ──
    inserted_count = result.get("inserted", 0) if isinstance(result, dict) else 1
    if inserted_count > 0:
        await ws_manager.broadcast({
            "type":     "defect_inserted",
            "inserted": inserted_count,
            "date":     str(date.today()),
        })
    return result

@app.post("/form/volume")
async def api_form_volume(body: FormVolumeBody, bg: BackgroundTasks):
    data = VolumeFormInsert(
        v_model    = body.model_name,
        v_shift    = body.shift,
        v_line     = body.line,
        v_quantity = body.quantity,
        v_prod_time= body.production_date
    )
    result = insert_volume(data)
    bg.add_task(sync_volume)
    await ws_manager.broadcast({"type": "data_updated", "source": "volume_inserted", "date": str(date.today())})
    return result

# ─── Volume ───────────────────────────────────────────────────────── #
@app.get("/volume")
def api_record_volume(
    date_from: Optional[date] = None,
    date_to:   Optional[date] = None,
    shift:     Optional[str]  = None,
    model:     Optional[str]  = None,
    line:      Optional[str]  = None,
):
    data = record_volume()
    return filter_volume(data, date_from=date_from, date_to=date_to, shift=shift, model=model, line=line)

@app.post("/volume")
async def api_insert_volume(data: VolumeFormInsert, bg: BackgroundTasks):
    result = insert_volume(data)
    bg.add_task(sync_volume)
    await ws_manager.broadcast({"type": "data_updated", "source": "volume_inserted", "date": str(date.today())})
    return result

@app.delete("/volume/{no}")
async def api_del_volume(no: int, bg: BackgroundTasks):
    ok = del_volume(no)
    if not ok:
        raise HTTPException(status_code=404, detail="Record not found")
    bg.add_task(sync_volume)
    await ws_manager.broadcast({"type": "data_updated", "source": "volume_deleted", "date": str(date.today())})
    return {"success": True}

# ─── Defect ───────────────────────────────────────────────────────── #
@app.get("/defect")
def api_record_defect(
    date_type:   str           = "scan",
    date_from:   Optional[date] = None,
    date_to:     Optional[date] = None,
    shift:       Optional[str]  = None,
    name:        Optional[str]  = None,
    defect_mode: Optional[str]  = None,
    model:       Optional[str]  = None,
    line:        Optional[str]  = None,
):
    data = record_defect()
    return filter_defect(
        data, date_type=date_type,
        date_from=date_from, date_to=date_to,
        shift=shift, name=name,
        defect_mode=defect_mode, model=model, line=line,
    )

@app.post("/defect")
async def api_insert_defect(data: DefectFormInsert, bg: BackgroundTasks):
    result = insert_defect(data)
    bg.add_task(sync_defect)
    await ws_manager.broadcast({"type": "data_updated", "source": "defect_inserted", "date": str(date.today())})
    return result

@app.delete("/defect/{no}")
async def api_del_defect(no: int, bg: BackgroundTasks):
    ok = del_defect(no)
    if not ok:
        raise HTTPException(status_code=404, detail="Record not found")
    bg.add_task(sync_defect)
    await ws_manager.broadcast({"type": "data_updated", "source": "defect_deleted", "date": str(date.today())})
    return {"success": True}

# ─── Report ───────────────────────────────────────────────────────── #
@app.get("/report")
def api_record_report(
    date_from: Optional[date] = None,
    date_to:   Optional[date] = None,
    status:    Optional[str]  = None,
    mode:      Optional[str]  = None,
):
    data = record_report()
    return filter_report(data, date_from=date_from, date_to=date_to, status=status, mode=mode)

@app.post("/report")
def api_insert_report(data: ReportFormInsert, bg: BackgroundTasks):
    result = insert_report(data)
    bg.add_task(sync_report)
    return result

@app.delete("/report/{no}")
def api_del_report(no: int, bg: BackgroundTasks):
    ok = del_report(no)
    if not ok:
        raise HTTPException(status_code=404, detail="Record not found")
    bg.add_task(sync_report)
    return {"success": True}

# ─── Analyze ──────────────────────────────────────────────────────── #
@app.get("/analyze/daily-monitoring")
def api_daily_monitoring(
    defect_mode: Optional[str]  = None,
    defect_type: Optional[str]  = None,
    date_from:   Optional[date] = None,
    date_to:     Optional[date] = None,
):
    from datetime import date as date_type
    today = date_type.today()
    return get_daily_monitoring(
        defect_mode=defect_mode,
        defect_type=defect_type,
        date_from=date_from or today,
        date_to=date_to     or today,
    )

@app.get("/analyze/data-table")
def api_data_table():
    return get_data_table_summary()

@app.get("/analyze/daily-ratio")
def api_daily_ratio(
    date_from:   Optional[date] = None,
    date_to:     Optional[date] = None,
    shift:       Optional[str]  = None,
    model:       Optional[str]  = None,
    defect_mode: Optional[str]  = None,
    line:        Optional[str]  = None,
    date_preset: Optional[str]  = None,
    date_type:   Optional[str]  = "production",  # default production เสมอ
):
    return get_daily_ratio(
        date_from=date_from, date_to=date_to,
        shift=shift, model=model,
        defect_mode=defect_mode, line=line,
        date_preset=date_preset,
        date_type=date_type,
    )

@app.get("/analyze")
def api_analyze(
    date_from:   Optional[date] = None,
    date_to:     Optional[date] = None,
    shift:       Optional[str]  = None,
    model:       Optional[str]  = None,
    defect_mode: Optional[str]  = None,
    line:        Optional[str]  = None,
    date_preset: Optional[str]  = None,
):
    """
    Returns: by_shift, by_day_night, by_model, by_core_no, table (model×line with ratio).
    """
    return get_analyze(
        date_from=date_from, date_to=date_to,
        shift=shift, model=model,
        defect_mode=defect_mode, line=line,
    )

@app.get("/analyze/breakdown")
def api_breakdown(
    date_from:   Optional[date] = None,
    date_to:     Optional[date] = None,
    shift:       Optional[str]  = None,
    model:       Optional[str]  = None,
    defect_mode: Optional[str]  = None,
    line:        Optional[str]  = None,
):
    """
    Returns breakdown by tank_top, tank_btm, ph_top, ph_btm (Sankey-style categories).
    """
    return get_breakdown(
        date_from=date_from, date_to=date_to,
        shift=shift, model=model,
        defect_mode=defect_mode, line=line,
    )

@app.get("/analyze/daily-trend")
def api_daily_trend(
    defect_type: Optional[str]  = None,
    defect_mode: Optional[str]  = None,
    date_from:   Optional[date] = None,
    date_to:     Optional[date] = None,
):
    from datetime import date as date_type
    today = date_type.today()
    return get_daily_trend(
        defect_type=defect_type,
        defect_mode=defect_mode,
        date_from=date_from or today,
        date_to=date_to     or today,
    )

@app.get("/analyze/daily-trend-combined")
def api_daily_trend_combined(
    defect_mode: Optional[str]  = None,
    date_from:   Optional[date] = None,
    date_to:     Optional[date] = None,
):
    """
    Combined After Day + Before Day daily trend
    Response shape per item:
    {
      date, volume,
      total_defect, defect_after, defect_before,
      ratio, ratio_after, ratio_before,
      by_mode: { mode: count }
    }
    """
    from datetime import date as date_type
    today = date_type.today()
    return get_daily_trend_combined(
        defect_mode=defect_mode,
        date_from=date_from or today,
        date_to=date_to     or today,
    )

@app.get("/records/defect")
def api_records_defect():
    """
    อ่านจาก DuckDB cache (มีข้อมูลจาก CSV + form ครบทั้งหมด)
    ไม่ผ่าน SQLite join ซึ่งอาจตัดแถวออกถ้า FK ไม่ match
    """
    from .cache import get_read_con
    cur = get_read_con()
    rows = cur.execute("""
        SELECT no, name, scan_date, scan_time, shift, group_,
               model_qr, defect_qr,
               defect_mode, defect_code, defect_by_process, defect_type,
               part_no, core_no, model_name,
               prod_date, prod_time, work_tag, line,
               ph_top, die_list_ph_top, ph_btm, die_list_ph_btm,
               th_top, th_btm
        FROM defect
        ORDER BY scan_date DESC, scan_time DESC
    """).fetchall()
    cols = [d[0] for d in cur.description]
 
    result = []
    for i, row in enumerate(rows, 1):
        r     = dict(zip(cols, row))
        shift = r.get("shift") or ""
        group = r.get("group_") or ""
        result.append({
            "no":                i,
            "name":              r.get("name") or "",
            "date_day":          str(r.get("scan_date") or ""),
            "time":              str(r.get("scan_time") or ""),
            "shift_group":       f"{shift}/{group}" if shift and group else shift,
            "line":              r.get("line") or "",
            "model_qr":          r.get("model_qr") or "",
            "defect_qr":         r.get("defect_qr") or "",
            "defect_mode":       r.get("defect_mode") or "",
            "defect_code":       r.get("defect_code") or "",
            "defect_by_process": r.get("defect_by_process") or "",
            "defect_type":       r.get("defect_type") or "",
            "part_no":           r.get("part_no") or "",
            "core_no":           r.get("core_no") or "",
            "model":             r.get("model_name") or "",
            "production_date":   r.get("prod_date") or "",
            "production_time":   r.get("prod_time") or "",
            "work_tag":          r.get("work_tag") or "",
            "ph_top":            r.get("ph_top") or "",
            "die_list_ph_top":   r.get("die_list_ph_top") or "",
            "ph_btm":            r.get("ph_btm") or "",
            "die_list_ph_btm":   r.get("die_list_ph_btm") or "",
            "th_top":            r.get("th_top") or "",
            "th_btm":            r.get("th_btm") or "",
        })
    return result

@app.get("/records/volume")
def api_records_volume():
    rows = record_volume()
    return [
        {
            "no":              r["no"],
            "date_day":        str(r["scan_date"]),
            "time":            str(r["scan_time"]),
            "line":            r["line"],
            "model":           r["model_name"],
            "quantity":        r["quantity"],
            "part_no":         r.get("part_no", ""),
            "production_date": r.get("prod_date", ""),
            "ph_top":          r["ph_top"],
            "die_list_ph_top": r["die_list_ph_top"],
            "ph_btm":          r["ph_btm"],
            "die_list_ph_btm": r["die_list_ph_btm"],
            "th_top":          r["th_top"],
            "th_btm":          r["th_btm"],
            "shift":           r["shift"],
            "group":           r.get("group", ""),
            "shift_group":     r.get("shift_group", r["shift"]),
        }
        for r in rows
    ]

@app.get("/records/report")
def api_records_report():
    rows = record_report()
    return [
        {
            "no":                r["no"],
            "mode":              r["mode"],
            "assumption_detail": r["assumption_detail"],
            "action_detail":     r["action_detail"],
            "date_day":          str(r["date_day"]),
            "pic":               r["pic"],
            "progress":          r["progress"],
            "status":            r["status"],
        }
        for r in rows
    ]

# ─── Correction Note ──────────────────────────────────────────────── #
# ── Targets per view type ──────────────────────────────────────────── #
DEFECT_TARGET_BOTH   = 1.8   # Both (After + Before) combined
DEFECT_TARGET_AFTER  = 1.0   # After Day only
DEFECT_TARGET_BEFORE = 0.8   # Before Day only
DEFECT_TARGET        = DEFECT_TARGET_BOTH  # legacy alias

def _get_target(view_type: str) -> float:
    if view_type == "after":  return DEFECT_TARGET_AFTER
    if view_type == "before": return DEFECT_TARGET_BEFORE
    return DEFECT_TARGET_BOTH   # "All" / default

class CorrectionNoteBody(BaseModel):
    line:           str
    defect_type:    str
    changing_point: str
    note_date:      Optional[str] = None   # YYYY-MM-DD, default = today

@app.get("/correction/today")
def api_correction_today(view_type: Optional[str] = "All"):
    """
    ตรวจสอบสถานะวันนี้:
      - ratio_today  : ratio วันนี้ (แยกตาม view_type: All/after/before)
      - over_target  : True ถ้าเกิน target ของ view นั้น
      - note_required: True ถ้าเกิน target แต่ยังไม่มี correction note วันนี้
      - note         : correction note วันนี้ (None ถ้ายังไม่กรอก)
      - target       : target value ที่ใช้สำหรับ view นี้
    """
    from .cache import get_read_con
    from datetime import date as date_type
    today = date_type.today()
    target = _get_target(view_type or "All")

    cur = get_read_con()

    if (view_type or "All") == "after":
        row = cur.execute("""
            SELECT COALESCE(COUNT(*), 0) AS defect_count,
                   (SELECT COALESCE(SUM(quantity),0) FROM volume WHERE scan_date = ?) AS volume
            FROM defect d
            JOIN defect_mode dm ON d.defect_mode = dm.defect_mode
            WHERE d.scan_date = ? AND dm.defect_type = 'After Day'
        """, [today, today]).fetchone()
    elif (view_type or "All") == "before":
        row = cur.execute("""
            SELECT COALESCE(COUNT(*), 0) AS defect_count,
                   (SELECT COALESCE(SUM(quantity),0) FROM volume WHERE scan_date = ?) AS volume
            FROM defect d
            JOIN defect_mode dm ON d.defect_mode = dm.defect_mode
            WHERE d.scan_date = ? AND dm.defect_type = 'Before Day'
        """, [today, today]).fetchone()
    else:
        row = cur.execute("""
            SELECT COALESCE(SUM(1), 0)                         AS defect_count,
                   (SELECT COALESCE(SUM(quantity),0) FROM volume WHERE scan_date = ?) AS volume
            FROM defect WHERE scan_date = ?
        """, [today, today]).fetchone()

    defect_count = row[0] or 0
    volume       = row[1] or 0
    ratio_today  = round((defect_count / volume * 100), 4) if volume else 0.0
    over_target  = ratio_today >= target

    db = SessionLocal()
    try:
        note = db.query(CorrectionNote).filter(CorrectionNote.note_date == today).first()
        note_data = None
        if note:
            note_data = {
                "no":             note.no,
                "note_date":      str(note.note_date),
                "line":           note.line,
                "defect_type":    note.defect_type,
                "changing_point": note.changing_point,
                "created_at":     str(note.created_at),
            }
        return {
            "today":          str(today),
            "defect_count":   defect_count,
            "volume":         volume,
            "ratio_today":    ratio_today,
            "target":         target,
            "over_target":    over_target,
            "note_required":  over_target and note is None,
            "note":           note_data,
        }
    finally:
        db.close()

@app.post("/correction")
def api_post_correction(body: CorrectionNoteBody, bg: BackgroundTasks):
    """บันทึก correction note (1 วัน 1 record — upsert)"""
    from datetime import date as date_type
    note_date = date_type.fromisoformat(body.note_date) if body.note_date else date_type.today()

    db = SessionLocal()
    try:
        existing = db.query(CorrectionNote).filter(CorrectionNote.note_date == note_date).first()
        if existing:
            existing.line           = body.line
            existing.defect_type    = body.defect_type
            existing.changing_point = body.changing_point
            existing.created_at     = datetime.now()
        else:
            db.add(CorrectionNote(
                note_date      = note_date,
                line           = body.line,
                defect_type    = body.defect_type,
                changing_point = body.changing_point,
            ))
        db.commit()
        return {"success": True, "note_date": str(note_date)}
    finally:
        db.close()

@app.delete("/correction/{note_date}")
def api_delete_correction(note_date: str):
    """ลบ correction note ของวันที่ระบุ (YYYY-MM-DD)"""
    from datetime import date as date_type
    try:
        nd = date_type.fromisoformat(note_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format, use YYYY-MM-DD")
    db = SessionLocal()
    try:
        note = db.query(CorrectionNote).filter(CorrectionNote.note_date == nd).first()
        if not note:
            raise HTTPException(status_code=404, detail="Correction note not found")
        db.delete(note)
        db.commit()
        return {"success": True, "deleted_date": str(nd)}
    finally:
        db.close()

@app.get("/correction/history")
def api_correction_history():
    """คืน correction notes ทั้งหมด (สำหรับแสดง marker บนกราฟ)"""
    db = SessionLocal()
    try:
        notes = db.query(CorrectionNote).order_by(CorrectionNote.note_date).all()
        return [
            {
                "note_date":      str(n.note_date),
                "line":           n.line,
                "defect_type":    n.defect_type,
                "changing_point": n.changing_point,
                "created_at":     str(n.created_at),
            }
            for n in notes
        ]
    finally:
        db.close()

# ─── Debug ────────────────────────────────────────────────────────── #
@app.get("/debug/resync")
def resync():
    sync_defect()
    return {"done": True}

@app.get("/debug/auth-check")
def debug_auth_check(work_number: str):
    """
    ตรวจสอบสถานะ Employee ใน DB — ใช้ตอน debug 401 เท่านั้น
    ลบ endpoint นี้ก่อน deploy production
    """
    db = SessionLocal()
    try:
        from .database.database import Employee as EmpModel
        emp = db.query(EmpModel).filter(EmpModel.work_number == work_number).first()
        if not emp:
            return {"found": False, "work_number": work_number}
        return {
            "found":           True,
            "work_number":     emp.work_number,
            "name":            emp.name,
            "full_name":       getattr(emp, "full_name", None),
            "is_active":       emp.is_active,
            "has_password":    bool(emp.hashed_password),
            "role":            str(emp.role),
        }
    finally:
        db.close()

@app.get("/debug/employees-summary")
def debug_employees_summary():
    """แสดงสรุป Employee ทั้งหมดใน DB — ลบก่อน production"""
    db = SessionLocal()
    try:
        from .database.database import Employee as EmpModel
        rows = db.query(EmpModel).all()
        return {
            "total": len(rows),
            "with_password": sum(1 for r in rows if r.hashed_password),
            "without_password": sum(1 for r in rows if not r.hashed_password),
            "active": sum(1 for r in rows if r.is_active),
            "samples": [
                {
                    "work_number": r.work_number,
                    "name": r.name,
                    "has_password": bool(r.hashed_password),
                    "role": str(r.role),
                }
                for r in rows[:10]
            ],
        }
    finally:
        db.close()

@app.get("/debug/defect-dates")
def debug_dates():
    from .cache import get_read_con
    cur = get_read_con()
    rows = cur.execute("SELECT MIN(scan_date), MAX(scan_date), COUNT(*) FROM defect").fetchall()
    return {"result": rows}

@app.get("/debug/defect-modes-sample")
def debug_modes():
    db = SessionLocal()
    try:
        samples = db.query(DefectMode).limit(5).all()
        return [{"defect_item": d.defect_item, "defect_mode": d.defect_mode} for d in samples]
    finally:
        db.close()

# ─── TSD Expense ──────────────────────────────────────────────────── #
@app.get("/options/tsd-scrap-codes")
def api_opt_tsd_scrap_codes():
    db = SessionLocal()
    try:
        from .database.database import TSDExpense
        rows = db.query(TSDExpense.scrap_code).distinct().all()
        return sorted(set(r[0] for r in rows if r[0]))
    finally:
        db.close()

@app.get("/options/tsd-items")
def api_opt_tsd_items():
    db = SessionLocal()
    try:
        from .database.database import TSDExpense
        rows = db.query(TSDExpense.item).distinct().all()
        return sorted(set(r[0] for r in rows if r[0]))
    finally:
        db.close()

@app.get("/records/tsd-defect")
def api_records_tsd():
    db = SessionLocal()
    try:
        from .database.database import TSDExpense
        records = (
            db.query(TSDExpense)
            .outerjoin(TSDExpense.employee)
            .order_by(TSDExpense.date_day, TSDExpense.no)
            .all()
        )
        return [
            {
                "no":              i + 1,
                "date_day":        str(r.date_day),
                "shift_group":     f"{r.shift}/{r.group}" if r.shift and r.group else (r.shift or ""),
                "department name": (r.employee.department or "") if r.employee else "",
                "scrap_code":      r.scrap_code or "",
                "item":            r.item or "",
                "price":           r.price or 0,
                "quantity":        r.quantity or 0,
                "unit":            r.unit or "",
                "Total actual":    (r.price or 0) * (r.quantity or 0),
                "_id":             r.no,
            }
            for i, r in enumerate(records)
        ]
    finally:
        db.close()

@app.post("/form/tsd")
def api_form_tsd(body: TSDExpenseInsert, bg: BackgroundTasks):
    """
    บันทึก TSD Expense ใหม่ 1 รายการ
    Body: { work_number?, name?, shift, date_day?, scrap_code, item, price, quantity, unit }
    - ถ้ามี work_number → lookup employee ด้วย work_number (แนะนำ)
    - ถ้าไม่มี → fallback ค้นหาด้วย name / full_name
    - ถ้า employee.name เป็น NULL → auto-set เป็น full_name แล้ว commit ก่อน insert
    """
    from .database.database import TSDExpense
    from datetime import date as date_type

    db = SessionLocal()
    try:
        now      = datetime.now()
        group    = "Day" if time(7, 30) <= now.time() <= time(19, 50) else "Night"
        date_day = body.date_day or date_type.today()

        from .database.database import Employee as EmpModel

        # ── Resolve employee ──────────────────────────────────────────
        emp = None
        if body.work_number:
            emp = db.query(EmpModel).filter(EmpModel.work_number == body.work_number).first()
        if emp is None and body.name:
            emp = db.query(EmpModel).filter(EmpModel.name == body.name).first()
            if emp is None:
                emp = db.query(EmpModel).filter(EmpModel.full_name == body.name).first()

        if emp is None:
            ident = body.work_number or body.name or "(ไม่ระบุ)"
            raise HTTPException(status_code=404, detail=f"ไม่พบพนักงาน: {ident}")

        # ── Auto-patch: ถ้า employee.name เป็น NULL ให้ใช้ full_name ──
        # (ADMIN001 และ user ที่สร้างใหม่จาก /users/ อาจไม่มี name)
        if not emp.name:
            emp.name = emp.full_name or emp.work_number
            db.commit()
            db.refresh(emp)

        emp_name = emp.name
        if not emp_name:
            raise HTTPException(
                status_code=400,
                detail=f"Employee {emp.work_number} ไม่มีชื่อในระบบ กรุณาแก้ไขใน User Management"
            )

        rec = TSDExpense(
            date_day   = date_day,
            shift      = body.shift,
            group      = group,
            name       = emp_name,
            scrap_code = body.scrap_code,
            item       = body.item,
            price      = body.price,
            quantity   = body.quantity,
            unit       = body.unit,
        )
        db.add(rec)
        db.commit()
        db.refresh(rec)
        bg.add_task(sync_tsd_expense)
        return {"success": True, "no": rec.no}
    finally:
        db.close()

@app.delete("/records/tsd-defect/{record_id}")
def api_del_tsd(record_id: int, bg: BackgroundTasks):
    """ลบ TSD Expense ด้วย real DB id (ค่า _id จาก /records/tsd-defect)"""
    db = SessionLocal()
    try:
        from .database.database import TSDExpense
        rec = db.query(TSDExpense).filter(TSDExpense.no == record_id).first()
        if not rec:
            raise HTTPException(status_code=404, detail="Record not found")
        db.delete(rec)
        db.commit()
        bg.add_task(sync_tsd_expense)
        return {"success": True}
    finally:
        db.close()

@app.get("/tsd-summary")
def tsd_summary(
    date_from:   date       = Query(None),
    date_to:     date       = Query(None),
    scrap_codes: list[str]  = Query(None),
    department:  str        = Query(None),
):
    return get_tsd_summary(
        date_from=date_from,
        date_to=date_to,
        scrap_codes=scrap_codes,
        department=department,
    )

@app.get("/debug/sync-status")
def sync_status():
    """ตรวจสอบว่า DuckDB cache มีข้อมูลหรือยัง"""
    from .cache import get_read_con
    cur = get_read_con()
    defect_count = cur.execute("SELECT COUNT(*) FROM defect").fetchone()[0]
    volume_count = cur.execute("SELECT COUNT(*) FROM volume").fetchone()[0]
    return {
        "defect_rows": defect_count,
        "volume_rows": volume_count,
        "ready": defect_count > 0 or volume_count > 0,
    }