import threading
import time as _time
import duckdb
from pathlib import Path
from .database.database import (
    SessionLocal, Volume, Defect, Report, Model, Employee, DefectMode, TSDExpense,
    DUCKDB_PATH, DATABASE_URL, parse_model_qr,
)

# ─── Singleton Connection ─────────────────────────────────────────── #
_con:  duckdb.DuckDBPyConnection = None
_lock: threading.Lock            = threading.Lock()

_SQLITE_PATH = DATABASE_URL.replace("sqlite:///", "")


def get_con() -> duckdb.DuckDBPyConnection:
    global _con
    if _con is None:
        Path(DUCKDB_PATH).parent.mkdir(parents=True, exist_ok=True)
        _con = duckdb.connect(DUCKDB_PATH)
    return _con


def get_read_con() -> duckdb.DuckDBPyConnection:
    return get_con().cursor()


# ─── Init DuckDB Tables ───────────────────────────────────────────── #
def init_duckdb():
    con = get_con()
    con.execute("""
        CREATE TABLE IF NOT EXISTS volume (
            no          INTEGER PRIMARY KEY,
            model_name  VARCHAR,
            quantity    INTEGER,
            line        VARCHAR,
            shift       VARCHAR,
            group_      VARCHAR,
            scan_date   DATE,
            scan_time   TIME
        )
    """)
    # ── defect: เพิ่ม defect_by_process, defect_type และ model info ──
    con.execute("""
        CREATE TABLE IF NOT EXISTS defect (
            no                INTEGER PRIMARY KEY,
            name              VARCHAR,
            part_no           VARCHAR,
            model_name        VARCHAR,
            model_qr          VARCHAR,
            defect_qr         VARCHAR,
            defect_mode       VARCHAR,
            defect_code       VARCHAR,
            defect_by_process VARCHAR,
            defect_type       VARCHAR,
            ph_top            VARCHAR,
            die_list_ph_top   VARCHAR,
            ph_btm            VARCHAR,
            die_list_ph_btm   VARCHAR,
            th_top            VARCHAR,
            th_btm            VARCHAR,
            line              VARCHAR,
            core_no           VARCHAR,
            prod_date         VARCHAR,
            prod_time         VARCHAR,
            work_tag          VARCHAR,
            shift             VARCHAR,
            group_            VARCHAR,
            scan_date         DATE,
            scan_time         TIME
        )
    """)
    # ── Migration: เพิ่ม column ที่ขาดใน defect table เก่า ──
    _migrate_defect_table(con)

    con.execute("""
        CREATE TABLE IF NOT EXISTS report (
            no                  INTEGER PRIMARY KEY,
            mode                VARCHAR,
            assumption_detail   VARCHAR,
            assumption_img_url  VARCHAR,
            action_detail       VARCHAR,
            action_img_url      VARCHAR,
            date_day            DATE,
            pic                 VARCHAR,
            progress            INTEGER,
            status              VARCHAR
        )
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS model (
            part_no         VARCHAR PRIMARY KEY,
            model_name      VARCHAR,
            ph_top          VARCHAR,
            die_list_ph_top VARCHAR,
            ph_btm          VARCHAR,
            die_list_ph_btm VARCHAR,
            th_top          VARCHAR,
            th_btm          VARCHAR
        )
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS defect_mode (
            defect_item         VARCHAR PRIMARY KEY,
            defect_mode         VARCHAR,
            defect_code         VARCHAR,
            defect_by_process   VARCHAR,
            defect_type         VARCHAR
        )
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS employee (
            name        VARCHAR PRIMARY KEY,
            work_number VARCHAR,
            full_name   VARCHAR,
            department  VARCHAR,
            position    VARCHAR,
            role        VARCHAR,
            is_active   BOOLEAN
        )
    """)
    _migrate_employee_table(con)

    con.execute("""
        CREATE TABLE IF NOT EXISTS tsd_expense (
            no         INTEGER PRIMARY KEY,
            date_day   DATE,
            shift      VARCHAR,
            group_     VARCHAR,
            name       VARCHAR,
            department VARCHAR,
            scrap_code VARCHAR,
            item       VARCHAR,
            price      INTEGER,
            quantity   INTEGER,
            unit       VARCHAR
        )
    """)


def _migrate_defect_table(con):
    """เพิ่ม column ที่ขาดไปใน defect table เก่า"""
    existing_cols = {
        row[0].lower()
        for row in con.execute("DESCRIBE defect").fetchall()
    }
    new_cols = [
        ("defect_by_process", "VARCHAR"),
        ("defect_type",       "VARCHAR"),
        ("ph_top",            "VARCHAR"),
        ("die_list_ph_top",   "VARCHAR"),
        ("ph_btm",            "VARCHAR"),
        ("die_list_ph_btm",   "VARCHAR"),
        ("th_top",            "VARCHAR"),
        ("th_btm",            "VARCHAR"),
    ]
    for col, dtype in new_cols:
        if col not in existing_cols:
            try:
                con.execute(f"ALTER TABLE defect ADD COLUMN {col} {dtype}")
                print(f"[cache] migrated defect: added column {col}")
            except Exception as e:
                print(f"[cache] migrate defect.{col} skip: {e}")


def _migrate_employee_table(con):
    """เพิ่ม column ที่ขาดไปใน employee table เก่า"""
    existing_cols = {
        row[0].lower()
        for row in con.execute("DESCRIBE employee").fetchall()
    }
    migrations = [
        ("work_number", "VARCHAR"),
        ("full_name",   "VARCHAR"),
        ("department",  "VARCHAR"),
        ("position",    "VARCHAR"),
        ("role",        "VARCHAR"),
        ("is_active",   "BOOLEAN"),
    ]
    for col, dtype in migrations:
        if col not in existing_cols:
            try:
                con.execute(f"ALTER TABLE employee ADD COLUMN {col} {dtype}")
                print(f"[cache] migrated employee: added column {col}")
            except Exception as e:
                print(f"[cache] migrate employee.{col} skip: {e}")


# ─── Helpers ──────────────────────────────────────────────────────── #
def _delete_removed(con, table: str, sqlite_ids: set):
    existing = {row[0] for row in con.execute(f"SELECT no FROM {table}").fetchall()}
    to_delete = existing - sqlite_ids
    if to_delete:
        placeholders = ", ".join("?" * len(to_delete))
        con.execute(f"DELETE FROM {table} WHERE no IN ({placeholders})", list(to_delete))


def _attach_sqlite(con) -> bool:
    try:
        con.execute("DETACH DATABASE IF EXISTS sq")
    except Exception:
        pass
    try:
        con.execute(f"ATTACH '{_SQLITE_PATH}' AS sq (TYPE sqlite, READ_ONLY)")
        return True
    except Exception as e:
        print(f"[cache] attach sqlite failed: {e}")
        return False


def _detach_sqlite(con):
    try:
        con.execute("DETACH DATABASE IF EXISTS sq")
    except Exception:
        pass


# ─── Per-Table Sync ───────────────────────────────────────────────── #

def sync_master():
    with _lock:
        db  = SessionLocal()
        con = get_con()
        t0  = _time.perf_counter()
        try:
            # ── Model ──
            model_rows = [
                (r.part_no, r.model_name, r.ph_top, r.die_list_ph_top,
                 r.ph_btm, r.die_list_ph_btm, r.th_top, r.th_btm)
                for r in db.query(Model).all()
            ]
            if model_rows:
                con.executemany("""
                    INSERT INTO model
                        (part_no, model_name, ph_top, die_list_ph_top, ph_btm, die_list_ph_btm, th_top, th_btm)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT (part_no) DO UPDATE SET
                        model_name      = excluded.model_name,
                        ph_top          = excluded.ph_top,
                        die_list_ph_top = excluded.die_list_ph_top,
                        ph_btm          = excluded.ph_btm,
                        die_list_ph_btm = excluded.die_list_ph_btm,
                        th_top          = excluded.th_top,
                        th_btm          = excluded.th_btm
                """, model_rows)

            # ── DefectMode ──
            dm_rows = [
                (r.defect_item, r.defect_mode, r.defect_code, r.defect_by_process, r.defect_type)
                for r in db.query(DefectMode).all()
            ]
            if dm_rows:
                con.executemany("""
                    INSERT INTO defect_mode
                        (defect_item, defect_mode, defect_code, defect_by_process, defect_type)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT (defect_item) DO UPDATE SET
                        defect_mode       = excluded.defect_mode,
                        defect_code       = excluded.defect_code,
                        defect_by_process = excluded.defect_by_process,
                        defect_type       = excluded.defect_type
                """, dm_rows)

            # ── Employee ──
            emp_rows = [
                (
                    r.name or "",
                    r.work_number or "",
                    getattr(r, "full_name", None) or r.name or "",
                    getattr(r, "department", None) or "",
                    getattr(r, "position", None) or "",
                    str(r.role.value if hasattr(r.role, "value") else r.role),
                    r.is_active if r.is_active is not None else True,
                )
                for r in db.query(Employee).all()
                if r.name
            ]
            if emp_rows:
                con.executemany("""
                    INSERT INTO employee
                        (name, work_number, full_name, department, position, role, is_active)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT (name) DO UPDATE SET
                        work_number = excluded.work_number,
                        full_name   = excluded.full_name,
                        department  = excluded.department,
                        position    = excluded.position,
                        role        = excluded.role,
                        is_active   = excluded.is_active
                """, emp_rows)

            print(f"[cache] sync_master done ({_time.perf_counter()-t0:.2f}s)")
        finally:
            db.close()


def sync_volume():
    with _lock:
        con = get_con()
        t0  = _time.perf_counter()
        try:
            if _attach_sqlite(con):
                con.execute("""
                    INSERT INTO volume
                        (no, model_name, quantity, line, shift, group_, scan_date, scan_time)
                    SELECT v.no,
                           COALESCE(m.model_name, v.model_name),
                           v.quantity,
                           v.line,
                           v.shift,
                           v."group",
                           CAST(v.scan_date AS DATE),
                           CAST(v.scan_time AS TIME)
                    FROM sq.volume v
                    LEFT JOIN sq.model m ON v.model_name = m.model_name
                    ON CONFLICT (no) DO UPDATE SET
                        model_name = excluded.model_name,
                        quantity   = excluded.quantity,
                        line       = excluded.line,
                        shift      = excluded.shift,
                        group_     = excluded.group_,
                        scan_date  = excluded.scan_date,
                        scan_time  = excluded.scan_time
                """)
                sqlite_ids = {
                    row[0] for row in
                    con.execute("SELECT no FROM sq.volume").fetchall()
                }
                _detach_sqlite(con)
            else:
                db = SessionLocal()
                try:
                    records = db.query(Volume).outerjoin(Volume.model).all()
                    rows = [
                        (r.no, r.model_name or "", r.quantity, r.line,
                         r.shift, r.group, r.scan_date, r.scan_time)
                        for r in records
                    ]
                    if rows:
                        con.executemany("""
                            INSERT INTO volume
                                (no, model_name, quantity, line, shift, group_, scan_date, scan_time)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                            ON CONFLICT (no) DO UPDATE SET
                                model_name = excluded.model_name,
                                quantity   = excluded.quantity,
                                line       = excluded.line,
                                shift      = excluded.shift,
                                group_     = excluded.group_,
                                scan_date  = excluded.scan_date,
                                scan_time  = excluded.scan_time
                        """, rows)
                    sqlite_ids = {r.no for r in records}
                finally:
                    db.close()

            _delete_removed(con, "volume", sqlite_ids)
            print(f"[cache] sync_volume done ({_time.perf_counter()-t0:.2f}s)")
        except Exception as e:
            _detach_sqlite(con)
            raise e


def sync_defect():
    """
    Sync defect จาก SQLite → DuckDB
    JOIN defect_mode และ model เพื่อดึง defect_by_process, defect_type, ph_top ฯลฯ
    """
    with _lock:
        con = get_con()
        t0  = _time.perf_counter()
        try:
            if _attach_sqlite(con):
                con.execute("""
                    INSERT INTO defect (
                        no, name, part_no, model_name, model_qr, defect_qr,
                        defect_mode, defect_code, defect_by_process, defect_type,
                        ph_top, die_list_ph_top, ph_btm, die_list_ph_btm, th_top, th_btm,
                        line, core_no, prod_date, prod_time, work_tag,
                        shift, group_, scan_date, scan_time
                    )
                    SELECT
                        d.no,
                        COALESCE(e.name, d.name)                        AS name,
                        substr(d.model_qr, 1, 13)                       AS part_no,
                        m.model_name,
                        d.model_qr,
                        d.defect_qr,
                        dm.defect_mode,
                        dm.defect_code,
                        dm.defect_by_process,
                        dm.defect_type,
                        m.ph_top,
                        m.die_list_ph_top,
                        m.ph_btm,
                        m.die_list_ph_btm,
                        m.th_top,
                        m.th_btm,
                        substr(d.model_qr, 14, 3)                       AS line,
                        substr(d.model_qr, 15, 2)                       AS core_no,
                        substr(d.model_qr, 17, 6)                       AS prod_date,
                        substr(d.model_qr, 23, 6)                       AS prod_time,
                        substr(d.model_qr, 29)                          AS work_tag,
                        d.shift,
                        d."group",
                        CAST(d.scan_date AS DATE),
                        CAST(d.scan_time AS TIME)
                    FROM sq.defect d
                    LEFT JOIN sq.employee    e  ON d.name      = e.name
                    LEFT JOIN sq.model       m  ON substr(d.model_qr, 1, 13) = m.part_no
                    LEFT JOIN sq.defect_mode dm ON d.defect_qr = dm.defect_item
                    ON CONFLICT (no) DO UPDATE SET
                        name              = excluded.name,
                        part_no           = excluded.part_no,
                        model_name        = excluded.model_name,
                        model_qr          = excluded.model_qr,
                        defect_qr         = excluded.defect_qr,
                        defect_mode       = excluded.defect_mode,
                        defect_code       = excluded.defect_code,
                        defect_by_process = excluded.defect_by_process,
                        defect_type       = excluded.defect_type,
                        ph_top            = excluded.ph_top,
                        die_list_ph_top   = excluded.die_list_ph_top,
                        ph_btm            = excluded.ph_btm,
                        die_list_ph_btm   = excluded.die_list_ph_btm,
                        th_top            = excluded.th_top,
                        th_btm            = excluded.th_btm,
                        line              = excluded.line,
                        core_no           = excluded.core_no,
                        prod_date         = excluded.prod_date,
                        prod_time         = excluded.prod_time,
                        work_tag          = excluded.work_tag,
                        shift             = excluded.shift,
                        group_            = excluded.group_,
                        scan_date         = excluded.scan_date,
                        scan_time         = excluded.scan_time
                """)
                sqlite_ids = {
                    row[0] for row in
                    con.execute("SELECT no FROM sq.defect").fetchall()
                }
                _detach_sqlite(con)
            else:
                # ── Fallback: executemany ──
                db = SessionLocal()
                try:
                    records = (
                        db.query(Defect)
                        .outerjoin(Defect.model)
                        .outerjoin(Defect.defect_mode)
                        .outerjoin(Defect.employee)
                        .all()
                    )
                    rows = []
                    for r in records:
                        p   = parse_model_qr(r.model_qr) if r.model_qr else {}
                        emp = r.employee
                        m   = r.model
                        dm  = r.defect_mode
                        rows.append((
                            r.no,
                            (emp.name or emp.full_name or "") if emp else "",
                            r.part_no or p.get("part_no", ""),
                            m.model_name if m else "",
                            r.model_qr,
                            r.defect_qr,
                            dm.defect_mode       if dm else "",
                            dm.defect_code       if dm else "",
                            dm.defect_by_process if dm else "",
                            dm.defect_type       if dm else "",
                            m.ph_top            if m else "",
                            m.die_list_ph_top   if m else "",
                            m.ph_btm            if m else "",
                            m.die_list_ph_btm   if m else "",
                            m.th_top            if m else "",
                            m.th_btm            if m else "",
                            p.get("line", ""),
                            p.get("core_no", ""),
                            p.get("prod_date", ""),
                            p.get("prod_time", ""),
                            p.get("work_tag", ""),
                            r.shift,
                            r.group,
                            r.scan_date,
                            r.scan_time,
                        ))
                    if rows:
                        con.executemany("""
                            INSERT INTO defect (
                                no, name, part_no, model_name, model_qr, defect_qr,
                                defect_mode, defect_code, defect_by_process, defect_type,
                                ph_top, die_list_ph_top, ph_btm, die_list_ph_btm, th_top, th_btm,
                                line, core_no, prod_date, prod_time, work_tag,
                                shift, group_, scan_date, scan_time
                            )
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            ON CONFLICT (no) DO UPDATE SET
                                name              = excluded.name,
                                part_no           = excluded.part_no,
                                model_name        = excluded.model_name,
                                model_qr          = excluded.model_qr,
                                defect_qr         = excluded.defect_qr,
                                defect_mode       = excluded.defect_mode,
                                defect_code       = excluded.defect_code,
                                defect_by_process = excluded.defect_by_process,
                                defect_type       = excluded.defect_type,
                                ph_top            = excluded.ph_top,
                                die_list_ph_top   = excluded.die_list_ph_top,
                                ph_btm            = excluded.ph_btm,
                                die_list_ph_btm   = excluded.die_list_ph_btm,
                                th_top            = excluded.th_top,
                                th_btm            = excluded.th_btm,
                                line              = excluded.line,
                                core_no           = excluded.core_no,
                                prod_date         = excluded.prod_date,
                                prod_time         = excluded.prod_time,
                                work_tag          = excluded.work_tag,
                                shift             = excluded.shift,
                                group_            = excluded.group_,
                                scan_date         = excluded.scan_date,
                                scan_time         = excluded.scan_time
                        """, rows)
                    sqlite_ids = {r.no for r in records}
                finally:
                    db.close()

            _delete_removed(con, "defect", sqlite_ids)
            print(f"[cache] sync_defect done ({_time.perf_counter()-t0:.2f}s)")
        except Exception as e:
            _detach_sqlite(con)
            raise e


def sync_report():
    with _lock:
        db  = SessionLocal()
        con = get_con()
        t0  = _time.perf_counter()
        try:
            records = db.query(Report).all()
            rows = [
                (r.no, r.mode, r.assumption_detail, r.assumption_img_url,
                 r.action_detail, r.action_img_url, r.date_day,
                 r.pic, r.progress, r.status)
                for r in records
            ]
            if rows:
                con.executemany("""
                    INSERT INTO report (
                        no, mode, assumption_detail, assumption_img_url,
                        action_detail, action_img_url, date_day, pic, progress, status
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT (no) DO UPDATE SET
                        mode               = excluded.mode,
                        assumption_detail  = excluded.assumption_detail,
                        assumption_img_url = excluded.assumption_img_url,
                        action_detail      = excluded.action_detail,
                        action_img_url     = excluded.action_img_url,
                        date_day           = excluded.date_day,
                        pic                = excluded.pic,
                        progress           = excluded.progress,
                        status             = excluded.status
                """, rows)
            _delete_removed(con, "report", {r.no for r in records})
            print(f"[cache] sync_report done ({_time.perf_counter()-t0:.2f}s)")
        finally:
            db.close()


def sync_tsd_expense():
    with _lock:
        con = get_con()
        t0  = _time.perf_counter()
        try:
            if _attach_sqlite(con):
                con.execute("""
                    INSERT INTO tsd_expense (
                        no, date_day, shift, group_, name, department,
                        scrap_code, item, price, quantity, unit
                    )
                    SELECT
                        t.no,
                        CAST(t.date_day AS DATE),
                        t.shift,
                        t."group",
                        t.name,
                        e.department,
                        t.scrap_code,
                        t.item,
                        t.price,
                        t.quantity,
                        t.unit
                    FROM sq.tsd_expense t
                    LEFT JOIN sq.employee e ON t.name = e.name
                    ON CONFLICT (no) DO UPDATE SET
                        date_day   = excluded.date_day,
                        shift      = excluded.shift,
                        group_     = excluded.group_,
                        name       = excluded.name,
                        department = excluded.department,
                        scrap_code = excluded.scrap_code,
                        item       = excluded.item,
                        price      = excluded.price,
                        quantity   = excluded.quantity,
                        unit       = excluded.unit
                """)
                sqlite_ids = {
                    row[0] for row in
                    con.execute("SELECT no FROM sq.tsd_expense").fetchall()
                }
                _detach_sqlite(con)
            else:
                db = SessionLocal()
                try:
                    records = db.query(TSDExpense).outerjoin(TSDExpense.employee).all()
                    rows = [
                        (r.no, r.date_day, r.shift, r.group,
                         (r.employee.name or r.employee.full_name or "") if r.employee else "",
                         r.employee.department if r.employee else "",
                         r.scrap_code, r.item, r.price, r.quantity, r.unit)
                        for r in records
                    ]
                    if rows:
                        con.executemany("""
                            INSERT INTO tsd_expense (
                                no, date_day, shift, group_, name, department,
                                scrap_code, item, price, quantity, unit
                            )
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            ON CONFLICT (no) DO UPDATE SET
                                date_day   = excluded.date_day,
                                shift      = excluded.shift,
                                group_     = excluded.group_,
                                name       = excluded.name,
                                department = excluded.department,
                                scrap_code = excluded.scrap_code,
                                item       = excluded.item,
                                price      = excluded.price,
                                quantity   = excluded.quantity,
                                unit       = excluded.unit
                        """, rows)
                    sqlite_ids = {r.no for r in records}
                finally:
                    db.close()

            _delete_removed(con, "tsd_expense", sqlite_ids)
            print(f"[cache] sync_tsd_expense done ({_time.perf_counter()-t0:.2f}s)")
        except Exception as e:
            _detach_sqlite(con)
            raise e


def sync_all():
    t0 = _time.perf_counter()
    for name, fn in [
        ("sync_master",      sync_master),
        ("sync_volume",      sync_volume),
        ("sync_defect",      sync_defect),
        ("sync_report",      sync_report),
        ("sync_tsd_expense", sync_tsd_expense),
    ]:
        try:
            fn()
        except Exception as e:
            print(f"[cache] {name} error: {e}")
    print(f"[cache] sync_all total ({_time.perf_counter()-t0:.2f}s)")


# ─── Query DuckDB ─────────────────────────────────────────────────── #
def query_volume() -> list[dict]:
    cur  = get_read_con()
    rows = cur.execute("SELECT * FROM volume ORDER BY scan_date, scan_time").fetchall()
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in rows]


def query_defect() -> list[dict]:
    cur  = get_read_con()
    rows = cur.execute("SELECT * FROM defect ORDER BY scan_date DESC, scan_time DESC").fetchall()
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in rows]


def query_report() -> list[dict]:
    cur  = get_read_con()
    rows = cur.execute("SELECT * FROM report ORDER BY date_day").fetchall()
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in rows]