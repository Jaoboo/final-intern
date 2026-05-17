"""
รัน script นี้ครั้งเดียวเพื่อสร้างตาราง + Admin account เริ่มต้น
วิธีรัน (จาก folder backend/):
    python -m app.init_db
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database.database import engine, SessionLocal, Base, Employee, Role
from app.auth_utils import hash_password

# สร้างตาราง
Base.metadata.create_all(bind=engine)

db = SessionLocal()

existing = db.query(Employee).filter(Employee.work_number == "ADMIN001").first()
if not existing:
    admin = Employee(
        name            = "System Admin",
        work_number     = "ADMIN001",
        department      = "IT",
        position        = "Administrator",
        role            = Role.admin,
        hashed_password = hash_password("admin1234"),
        is_active       = True,
    )
    db.add(admin)
    db.commit()
    print("สร้าง Admin สำเร็จ: ADMIN001 / admin1234")
    print("กรุณาเปลี่ยน password ด่วนหลัง deploy!")
else:
    print("ℹ️  มี Admin อยู่แล้ว")

db.close()