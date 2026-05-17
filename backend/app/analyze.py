from datetime import date
from collections import defaultdict
from .cache import get_read_con

def _con():
    return get_read_con()

def _ratio(defect: int, volume: int) -> float:
    if not volume:
        return 0.0
    return round((defect / volume) * 100, 4)

def _rows(con, sql: str, params: list = []) -> list[dict]:
    res  = con.execute(sql, params)
    cols = [d[0] for d in res.description]
    return [dict(zip(cols, r)) for r in res.fetchall()]

# ─── Shared Helpers ───────────────────────────────────────────────── #
def _build_defect_where(shift, model, defect_mode, line, date_a, date_b, date_col="d.scan_date"):
    conds  = [f"{date_col} BETWEEN ? AND ?"]
    params = [date_a, date_b]
    if shift:       conds.append("d.shift = ?");       params.append(shift)
    if model:       conds.append("d.model_name = ?");  params.append(model)
    if defect_mode: conds.append("d.defect_mode = ?"); params.append(defect_mode)
    if line:        conds.append("d.line = ?");        params.append(line)
    return "WHERE " + " AND ".join(conds), params

def _build_volume_where(shift, model, line, date_a, date_b):
    conds  = ["scan_date BETWEEN ? AND ?"]
    params = [date_a, date_b]
    if model: conds.append("model_name = ?"); params.append(model)
    if line:  conds.append("line = ?");       params.append(line)
    if shift: conds.append("shift = ?");      params.append(shift)
    return "WHERE " + " AND ".join(conds), params

def _combine_ratio(defects: list, volumes: list) -> list:
    """รวม defect (by_mode) + volume แล้วคำนวณ ratio"""
    v_map: dict = {r["period"]: r["volume_count"] for r in volumes}
    day_map: dict = defaultdict(lambda: {"by_mode": defaultdict(int), "volume": 0})
    for r in defects:
        p = str(r["period"])
        day_map[p]["by_mode"][r["defect_mode"]] += r["defect_count"]
    for p, vol in v_map.items():
        day_map[p]["volume"] = vol
    result = []
    for period in sorted(day_map.keys()):
        row   = day_map[period]
        total = sum(row["by_mode"].values())
        vol   = row["volume"]
        result.append({
            "prod_date": period,
            "by_mode":   dict(row["by_mode"]),
            "volume":    vol,
            "ratio":     _ratio(total, vol),
        })
    return result

# ─── Daily Monitoring ─────────────────────────────────────────────── #
def get_daily_monitoring(
    defect_mode: str  = None,
    defect_type: str  = None,
    date_from:   date = None,
    date_to:     date = None,
) -> dict:
    con         = _con()
    today       = date.today()
    month_start = today.replace(day=1)
    cost_unit   = 550

    # ── FIX: ใช้ LEFT JOIN กับ defect_mode table ใน DuckDB ──
    # DuckDB มีตาราง defect_mode แยกต่างหาก sync มาจาก SQLite
    def _build_filter(extra_params: list) -> tuple[str, list]:
        conds  = []
        params = list(extra_params)
        if defect_mode:
            conds.append("d.defect_mode = ?"); params.append(defect_mode)
        if defect_type:
            # JOIN กับ defect_mode table เพื่อ filter defect_type
            conds.append("dm.defect_type = ?"); params.append(defect_type)
        clause = ("AND " + " AND ".join(conds)) if conds else ""
        return clause, params

    def _defect_count(date_a, date_b) -> int:
        extra, params = _build_filter([date_a, date_b])
        # ใช้ LEFT JOIN — ถ้าไม่มี defect_type filter ไม่ต้อง JOIN
        if defect_type:
            sql = f"""
                SELECT COUNT(*) FROM defect d
                LEFT JOIN defect_mode dm ON d.defect_mode = dm.defect_mode
                WHERE d.scan_date BETWEEN ? AND ? {extra}
            """
        else:
            sql = f"""
                SELECT COUNT(*) FROM defect d
                WHERE d.scan_date BETWEEN ? AND ? {extra}
            """
        return con.execute(sql, params).fetchone()[0]

    def _volume_count(date_a, date_b) -> int:
        return con.execute(
            "SELECT COALESCE(SUM(quantity), 0) FROM volume WHERE scan_date BETWEEN ? AND ?",
            [date_a, date_b]
        ).fetchone()[0]

    d_month = _defect_count(month_start, today)
    v_month = _volume_count(month_start, today)

    d_select = v_select = 0
    if date_from and date_to:
        d_select = _defect_count(date_from, date_to)
        v_select = _volume_count(date_from, date_to)

    p_date_a = date_from if (date_from and date_to) else month_start
    p_date_b = date_to   if (date_from and date_to) else today
    extra, p_params = _build_filter([p_date_a, p_date_b])

    # Pareto — ใช้ LEFT JOIN เฉพาะตอนต้องการ defect_type
    if defect_type:
        pareto = _rows(con, f"""
            SELECT d.defect_mode, COUNT(*) AS defect_count
            FROM defect d
            LEFT JOIN defect_mode dm ON d.defect_mode = dm.defect_mode
            WHERE d.scan_date BETWEEN ? AND ? {extra}
            GROUP BY d.defect_mode
            ORDER BY defect_count DESC
        """, p_params)
    else:
        pareto = _rows(con, f"""
            SELECT d.defect_mode, COUNT(*) AS defect_count
            FROM defect d
            WHERE d.scan_date BETWEEN ? AND ? {extra}
            GROUP BY d.defect_mode
            ORDER BY defect_count DESC
        """, p_params)

    return {
        "month": {
            "defect_count": d_month,
            "volume_count": v_month,
            "ratio":        _ratio(d_month, v_month),
            "cost_total":   d_month * cost_unit,
        },
        "selected": {
            "defect_count":  d_select,
            "volume_count":  v_select,
            "ratio":         _ratio(d_select, v_select),
            "cost_estimate": d_select * cost_unit,
        },
        "pareto": pareto,
    }

# ─── Data Table Summary ───────────────────────────────────────────── #
def get_data_table_summary() -> dict:
    con         = _con()
    today       = date.today()
    month_start = today.replace(day=1)

    d_month = con.execute("SELECT COUNT(*) FROM defect WHERE scan_date BETWEEN ? AND ?", [month_start, today]).fetchone()[0]
    d_today = con.execute("SELECT COUNT(*) FROM defect WHERE scan_date = ?", [today]).fetchone()[0]
    v_month = con.execute("SELECT COALESCE(SUM(quantity), 0) FROM volume WHERE scan_date BETWEEN ? AND ?", [month_start, today]).fetchone()[0]
    v_today = con.execute("SELECT COALESCE(SUM(quantity), 0) FROM volume WHERE scan_date = ?", [today]).fetchone()[0]

    return {
        "defect": {"total_month": d_month, "total_today": d_today},
        "volume": {"total_month": v_month, "total_today": v_today},
    }

# ─── Daily Ratio by Scan Date ─────────────────────────────────────── #
def get_daily_ratio_by_scan(
    date_from:   date = None,
    date_to:     date = None,
    shift:       str  = None,
    model:       str  = None,
    defect_mode: str  = None,
    line:        str  = None,
    date_preset: str  = None,
) -> list:
    con    = _con()
    today  = date.today()
    date_a = date_from or today.replace(day=1)
    date_b = date_to   or today

    dw, d_params = _build_defect_where(shift, model, defect_mode, line, date_a, date_b, "d.scan_date")
    vw, v_params = _build_volume_where(shift, model, line, date_a, date_b)

    if date_preset == 'this_year':
        defects = _rows(con, f"""
            SELECT strftime(d.scan_date, '%Y-%m') AS period,
                   d.defect_mode, COUNT(*) AS defect_count
            FROM defect d {dw}
            GROUP BY period, d.defect_mode ORDER BY period
        """, d_params)
        volumes = _rows(con, f"""
            SELECT strftime(scan_date, '%Y-%m') AS period,
                   SUM(quantity) AS volume_count
            FROM volume {vw} GROUP BY period
        """, v_params)
    else:
        defects = _rows(con, f"""
            SELECT CAST(d.scan_date AS VARCHAR) AS period,
                   d.defect_mode, COUNT(*) AS defect_count
            FROM defect d {dw}
            GROUP BY d.scan_date, d.defect_mode ORDER BY d.scan_date
        """, d_params)
        volumes = _rows(con, f"""
            SELECT CAST(scan_date AS VARCHAR) AS period,
                   SUM(quantity) AS volume_count
            FROM volume {vw} GROUP BY scan_date
        """, v_params)

    return _combine_ratio(defects, volumes)

# ─── Daily Ratio by Production Date ──────────────────────────────── #
def get_daily_ratio_by_prod(
    date_from:   date = None,
    date_to:     date = None,
    shift:       str  = None,
    model:       str  = None,
    defect_mode: str  = None,
    line:        str  = None,
    date_preset: str  = None,
) -> list:
    con    = _con()
    today  = date.today()
    date_a = date_from or today.replace(day=1)
    date_b = date_to   or today

    dw, d_params = _build_defect_where(shift, model, defect_mode, line, date_a, date_b, "d.scan_date")
    vw, v_params = _build_volume_where(shift, model, line, date_a, date_b)

    if date_preset == 'this_year':
        # DDMMYY → YYYY-MM
        defects = _rows(con, f"""
            SELECT '20' || substr(d.prod_date, 5, 2) || '-'
                        || substr(d.prod_date, 3, 2) AS period,
                   d.defect_mode, COUNT(*) AS defect_count
            FROM defect d {dw}
            GROUP BY period, d.defect_mode ORDER BY period
        """, d_params)
        volumes = _rows(con, f"""
            SELECT strftime(scan_date, '%Y-%m') AS period,
                   SUM(quantity) AS volume_count
            FROM volume {vw} GROUP BY period
        """, v_params)
    else:
        # DDMMYY → YYYY-MM-DD
        defects = _rows(con, f"""
            SELECT '20' || substr(d.prod_date, 5, 2) || '-'
                        || substr(d.prod_date, 3, 2) || '-'
                        || substr(d.prod_date, 1, 2) AS period,
                   d.defect_mode, COUNT(*) AS defect_count
            FROM defect d {dw}
            GROUP BY period, d.defect_mode ORDER BY period
        """, d_params)
        volumes = _rows(con, f"""
            SELECT CAST(scan_date AS VARCHAR) AS period,
                   SUM(quantity) AS volume_count
            FROM volume {vw} GROUP BY scan_date
        """, v_params)

    return _combine_ratio(defects, volumes)

# ─── Daily Ratio wrapper ──────────────────────────────────────────── #
def get_daily_ratio(
    date_from:   date = None,
    date_to:     date = None,
    shift:       str  = None,
    model:       str  = None,
    defect_mode: str  = None,
    line:        str  = None,
    date_preset: str  = None,
    date_type:   str  = "production",
) -> list:
    if date_type == "scan":
        return get_daily_ratio_by_scan(
            date_from=date_from, date_to=date_to,
            shift=shift, model=model,
            defect_mode=defect_mode, line=line,
            date_preset=date_preset,
        )
    return get_daily_ratio_by_prod(
        date_from=date_from, date_to=date_to,
        shift=shift, model=model,
        defect_mode=defect_mode, line=line,
        date_preset=date_preset,
    )

# ─── Analyze ──────────────────────────────────────────────────────── #
def get_analyze(
    date_from:   date = None,
    date_to:     date = None,
    shift:       str  = None,
    model:       str  = None,
    defect_mode: str  = None,
    line:        str  = None,
) -> dict:
    con = _con()

    d_conds, d_params = [], []
    v_conds, v_params = [], []

    if date_from and date_to:
        d_conds.append("scan_date BETWEEN ? AND ?"); d_params += [date_from, date_to]
        v_conds.append("scan_date BETWEEN ? AND ?"); v_params += [date_from, date_to]
    if shift:
        d_conds.append("shift = ?");       d_params.append(shift)
        v_conds.append("shift = ?");       v_params.append(shift)
    if model:
        d_conds.append("model_name = ?");  d_params.append(model)
        v_conds.append("model_name = ?");  v_params.append(model)
    if defect_mode:
        d_conds.append("defect_mode = ?"); d_params.append(defect_mode)
    if line:
        d_conds.append("line = ?");        d_params.append(line)
        v_conds.append("line = ?");        v_params.append(line)

    dw = ("WHERE " + " AND ".join(d_conds)) if d_conds else ""
    vw = ("WHERE " + " AND ".join(v_conds)) if v_conds else ""

    by_shift = _rows(con, f"""
        SELECT shift, COUNT(*) AS defect_count
        FROM defect {dw}
        GROUP BY shift ORDER BY shift
    """, d_params)

    by_day_night = _rows(con, f"""
        SELECT group_ AS group, COUNT(*) AS defect_count
        FROM defect {dw}
        GROUP BY group_
    """, d_params)

    by_shift_daily = _rows(con, f"""
        SELECT CAST(scan_date AS VARCHAR) AS date,
               shift, COUNT(*) AS defect_count
        FROM defect {dw}
        GROUP BY scan_date, shift
        ORDER BY scan_date
    """, d_params)

    by_daynight_daily = _rows(con, f"""
        SELECT CAST(scan_date AS VARCHAR) AS date,
               group_ AS group, COUNT(*) AS defect_count
        FROM defect {dw}
        GROUP BY scan_date, group_
        ORDER BY scan_date
    """, d_params)

    by_model_raw = _rows(con, f"""
        SELECT model_name, COUNT(*) AS defect_count
        FROM defect {dw}
        GROUP BY model_name ORDER BY defect_count DESC
    """, d_params)

    v_by_model = _rows(con, f"""
        SELECT model_name, SUM(quantity) AS volume_count
        FROM volume {vw}
        GROUP BY model_name
    """, v_params)
    vm_map = {r["model_name"]: r["volume_count"] for r in v_by_model}
    for r in by_model_raw:
        r["volume_count"] = vm_map.get(r["model_name"], 0)

    by_core_no = _rows(con, f"""
        SELECT core_no, COUNT(*) AS defect_count
        FROM defect {dw}
        GROUP BY core_no ORDER BY defect_count DESC
    """, d_params)

    defect_tbl = _rows(con, f"""
        SELECT model_name, line, COUNT(*) AS defect_count
        FROM defect {dw}
        GROUP BY model_name, line ORDER BY model_name, line
    """, d_params)

    volume_tbl = _rows(con, f"""
        SELECT model_name, line, SUM(quantity) AS volume_count
        FROM volume {vw}
        GROUP BY model_name, line
    """, v_params)

    v_map = {(r["model_name"], r["line"]): r["volume_count"] for r in volume_tbl}
    for r in defect_tbl:
        r["volume_count"] = v_map.get((r["model_name"], r["line"]), 0)
        r["ratio"]        = _ratio(r["defect_count"], r["volume_count"])

    return {
        "by_shift":          by_shift,
        "by_day_night":      by_day_night,
        "by_shift_daily":    by_shift_daily,
        "by_daynight_daily": by_daynight_daily,
        "by_model":          by_model_raw,
        "by_core_no":        by_core_no,
        "table":             defect_tbl,
    }

# ─── Breakdown ────────────────────────────────────────────────────── #
def get_breakdown(
    date_from:   date = None,
    date_to:     date = None,
    shift:       str  = None,
    model:       str  = None,
    defect_mode: str  = None,
    line:        str  = None,
) -> dict:
    con = _con()

    d_conds, d_params = [], []
    if date_from and date_to:
        d_conds.append("d.scan_date BETWEEN ? AND ?"); d_params += [date_from, date_to]
    if shift:
        d_conds.append("d.shift = ?");       d_params.append(shift)
    if model:
        d_conds.append("d.model_name = ?");  d_params.append(model)
    if defect_mode:
        d_conds.append("d.defect_mode = ?"); d_params.append(defect_mode)
    if line:
        d_conds.append("d.line = ?");        d_params.append(line)
    dw = ("WHERE " + " AND ".join(d_conds)) if d_conds else ""

    def _section(part_col: str) -> dict:
        rows = _rows(con, f"""
            SELECT d.defect_mode, m.{part_col} AS part_label,
                   COUNT(*) AS defect_count
            FROM defect d
            JOIN model m ON d.part_no = m.part_no
            {dw}
            GROUP BY d.defect_mode, m.{part_col}
            ORDER BY defect_count DESC
        """, d_params)

        total   = sum(r["defect_count"] for r in rows)
        by_mode: dict = defaultdict(int)
        by_part: dict = defaultdict(int)
        for r in rows:
            by_mode[r["defect_mode"]] += r["defect_count"]
            by_part[r["part_label"] or "N/A"] += r["defect_count"]

        return {
            "total_defect": total,
            "by_mode": [{"defect_mode": k, "defect_count": v}
                        for k, v in sorted(by_mode.items(), key=lambda x: -x[1])],
            "by_part": [{"part_no": k, "defect_count": v}
                        for k, v in sorted(by_part.items(), key=lambda x: -x[1])],
        }

    return {
        "tank_top": _section("th_top"),
        "tank_btm": _section("th_btm"),
        "ph_top":   _section("ph_top"),
        "ph_btm":   _section("ph_btm"),
    }

# ─── Legacy daily trend (Dashboard) ──────────────────────────────── #
def get_daily_trend(
    defect_type: str  = None,
    defect_mode: str  = None,
    date_from:   date = None,
    date_to:     date = None,
) -> list:
    con         = _con()
    today       = date.today()
    month_start = today.replace(day=1)

    date_a = date_from or month_start
    date_b = date_to   or today

    # ── FIX: ใช้ LEFT JOIN แทน JOIN ──
    # ถ้า defect_mode table ไม่มีข้อมูล JOIN จะทำให้ได้ผลลัพธ์ว่าง
    conds  = ["d.scan_date BETWEEN ? AND ?"]
    params = [date_a, date_b]

    if defect_type:
        conds.append("dm.defect_type = ?"); params.append(defect_type)
    if defect_mode:
        conds.append("d.defect_mode = ?");  params.append(defect_mode)

    where = "WHERE " + " AND ".join(conds)

    # ใช้ LEFT JOIN เพื่อให้ได้ข้อมูลแม้ defect_mode table ยังไม่ sync ครบ
    if defect_type:
        defects = _rows(con, f"""
            SELECT d.scan_date, d.defect_mode, COUNT(*) AS defect_count
            FROM defect d
            LEFT JOIN defect_mode dm ON d.defect_mode = dm.defect_mode
            {where}
            GROUP BY d.scan_date, d.defect_mode
            ORDER BY d.scan_date
        """, params)
    else:
        defects = _rows(con, f"""
            SELECT d.scan_date, d.defect_mode, COUNT(*) AS defect_count
            FROM defect d
            {where}
            GROUP BY d.scan_date, d.defect_mode
            ORDER BY d.scan_date
        """, params)

    volumes = _rows(con, f"""
        SELECT scan_date, SUM(quantity) AS volume_count
        FROM volume WHERE scan_date BETWEEN ? AND ?
        GROUP BY scan_date
    """, [date_a, date_b])

    day_map: dict = defaultdict(lambda: {"defect_modes": {}, "volume": 0})
    for r in defects:
        d = str(r["scan_date"])
        day_map[d]["defect_modes"][r["defect_mode"]] = r["defect_count"]
    for r in volumes:
        d = str(r["scan_date"])
        day_map[d]["volume"] = r["volume_count"]

    result = []
    for day in sorted(day_map.keys()):
        total_defect = sum(day_map[day]["defect_modes"].values())
        vol          = day_map[day]["volume"]
        result.append({
            "date":         day,
            "volume":       vol,
            "total_defect": total_defect,
            "ratio":        round((total_defect / vol * 100), 4) if vol else 0,
            "by_mode":      day_map[day]["defect_modes"],
        })
    return result


def get_daily_trend_combined(
    defect_mode: str  = None,
    date_from:   date = None,
    date_to:     date = None,
) -> list:
    """
    Daily trend: After Day + Before Day รวมกันต่อวัน
    ── FIX: ใช้ LEFT JOIN แทน INNER JOIN ──
    ถ้า defect_mode table ยังไม่ sync ครบ INNER JOIN จะตัดข้อมูลออกหมด
    """
    con   = _con()
    today = date.today()

    date_a = date_from or today.replace(day=1)
    date_b = date_to   or today

    d_conds  = ["d.scan_date BETWEEN ? AND ?"]
    d_params = [date_a, date_b]
    if defect_mode:
        d_conds.append("d.defect_mode = ?"); d_params.append(defect_mode)
    d_where = "WHERE " + " AND ".join(d_conds)

    # ── FIX: LEFT JOIN แทน JOIN + กรอง defect_type ด้วย CASE ──
    # ทำให้ได้ข้อมูลแม้ defect_mode table ยังไม่ sync ครบ
    defects = _rows(con, f"""
        SELECT d.scan_date,
               d.defect_mode,
               COALESCE(dm.defect_type, 'Unknown') AS defect_type,
               COUNT(*) AS defect_count
        FROM defect d
        LEFT JOIN defect_mode dm ON d.defect_mode = dm.defect_mode
        {d_where}
        GROUP BY d.scan_date, d.defect_mode, dm.defect_type
        ORDER BY d.scan_date
    """, d_params)

    volumes = _rows(con, """
        SELECT scan_date, SUM(quantity) AS volume_count
        FROM volume WHERE scan_date BETWEEN ? AND ?
        GROUP BY scan_date
    """, [date_a, date_b])

    day_map: dict = defaultdict(lambda: {
        "by_mode":    defaultdict(int),
        "by_type":    {"After Day": 0, "Before Day": 0},
        "volume":     0,
    })

    for r in defects:
        d = str(r["scan_date"])
        day_map[d]["by_mode"][r["defect_mode"]] += r["defect_count"]
        dtype = r["defect_type"]
        if dtype in ("After Day", "Before Day"):
            day_map[d]["by_type"][dtype] += r["defect_count"]
        # ถ้า defect_type ไม่ใช่ After/Before ให้นับใน After Day เป็น fallback
        # เพื่อให้กราฟ "Both" แสดงข้อมูลได้
        else:
            day_map[d]["by_type"]["After Day"] += r["defect_count"]

    for r in volumes:
        d = str(r["scan_date"])
        day_map[d]["volume"] = r["volume_count"]

    result = []
    for day in sorted(day_map.keys()):
        row          = day_map[day]
        total_defect = sum(row["by_mode"].values())
        vol          = row["volume"]
        result.append({
            "date":         day,
            "volume":       vol,
            "total_defect": total_defect,
            "defect_after":  row["by_type"]["After Day"],
            "defect_before": row["by_type"]["Before Day"],
            "ratio":        _ratio(total_defect, vol),
            "ratio_after":  _ratio(row["by_type"]["After Day"],  vol),
            "ratio_before": _ratio(row["by_type"]["Before Day"], vol),
            "by_mode":      dict(row["by_mode"]),
        })
    return result


def get_tsd_summary(
    date_from:   date = None,
    date_to:     date = None,
    scrap_codes: list[str] = None,
    department:  str = None,
) -> dict:
    con   = _con()
    today = date.today()
    date_a = date_from or today.replace(day=1)
    date_b = date_to   or today

    conds  = ["date_day BETWEEN ? AND ?"]
    params = [date_a, date_b]
    if scrap_codes:
        placeholders = ",".join("?" * len(scrap_codes))
        conds.append(f"scrap_code IN ({placeholders})")
        params += scrap_codes
    if department:
        conds.append("department = ?")
        params.append(department)

    where = "WHERE " + " AND ".join(conds)

    grand_total = con.execute(
        f"SELECT COALESCE(SUM(price * quantity), 0) FROM tsd_expense {where}", params
    ).fetchone()[0]

    monthly = _rows(con, f"""
        SELECT strftime(date_day, '%Y%m') AS ym,
               scrap_code,
               SUM(price * quantity) AS total_actual
        FROM tsd_expense {where}
        GROUP BY ym, scrap_code
        ORDER BY ym, scrap_code
    """, params)

    by_dept = _rows(con, f"""
        SELECT department,
               SUM(price * quantity) AS total_actual
        FROM tsd_expense {where}
        GROUP BY department
        ORDER BY total_actual DESC
    """, params)

    daily = _rows(con, f"""
        SELECT date_day,
               SUM(price * quantity) AS daily_actual,
               SUM(SUM(price * quantity)) OVER (
                   PARTITION BY strftime(date_day, '%Y%m')
                   ORDER BY date_day
               ) AS cumulative_actual
        FROM tsd_expense {where}
        GROUP BY date_day
        ORDER BY date_day
    """, params)

    table = _rows(con, f"""
        SELECT department, item, scrap_code,
               SUM(quantity) AS quantity, unit,
               SUM(price * quantity) AS total_actual
        FROM tsd_expense {where}
        GROUP BY department, item, scrap_code, unit
        ORDER BY total_actual DESC
    """, params)

    return {
        "grand_total": grand_total,
        "monthly":     monthly,
        "by_dept":     by_dept,
        "daily":       daily,
        "table":       table,
    }