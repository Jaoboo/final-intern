"""
reset_admin.py — สร้างหรือ reset Admin account
รันจาก root folder ของโปรเจค (ที่มี /app อยู่):
    python reset_admin.py
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.database.database import SessionLocal, Employee, Base, engine, Role
from app.auth_utils import hash_password

# สร้างตารางถ้ายังไม่มี
Base.metadata.create_all(bind=engine)

db = SessionLocal()

try:
    emp = db.query(Employee).filter(Employee.work_number == "ADMIN001").first()

    if emp:
        print(f"พบ ADMIN001 อยู่แล้ว — กำลัง reset...")
        emp.hashed_password = hash_password("admin1234")
        emp.is_active       = True
        emp.role            = Role.admin
        # เติม full_name ถ้าว่าง (nullable=False อาจทำให้ login ไม่ได้)
        if not emp.full_name:
            emp.full_name = emp.name or "System Admin"
        db.commit()
        db.refresh(emp)
    else:
        print("ไม่พบ ADMIN001 — กำลังสร้างใหม่...")
        emp = Employee(
            work_number     = "ADMIN001",
            name            = "admin",          # ใช้เป็น FK ใน defect/tsd
            full_name       = "System Admin",
            department      = "IT",
            position        = "Administrator",
            role            = Role.admin,
            hashed_password = hash_password("admin1234"),
            is_active       = True,
        )
        db.add(emp)
        db.commit()
        db.refresh(emp)

    print("=" * 40)
    print(f"✅  สำเร็จ!")
    print(f"  work_number  : {emp.work_number}")
    print(f"  name         : {emp.name}")
    print(f"  full_name    : {emp.full_name}")
    print(f"  role         : {emp.role}")
    print(f"  is_active    : {emp.is_active}")
    print(f"  has_password : {bool(emp.hashed_password)}")
    print("=" * 40)
    print("Login ด้วย:  ADMIN001 / admin1234")
    print("⚠️  เปลี่ยน password ทันทีหลัง deploy!")

except Exception as e:
    db.rollback()
    print(f"❌ Error: {e}")
    raise
finally:
    db.close()