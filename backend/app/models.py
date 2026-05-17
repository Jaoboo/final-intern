from sqlalchemy import Column, String, Boolean, DateTime, Enum
from sqlalchemy.sql import func
from backend.app.database.database import Base
import enum

class Role(str, enum.Enum):
    admin = "admin"
    supervisor = "supervisor"
    operator = "operator"

class Employee(Base):
    __tablename__ = "employees"

    work_number  = Column(String, primary_key=True, index=True)  # รหัสพนักงาน
    full_name    = Column(String, nullable=False)
    department   = Column(String, nullable=False)
    position     = Column(String, nullable=False)
    role         = Column(Enum(Role), default=Role.operator, nullable=False)
    hashed_password = Column(String, nullable=False)
    is_active    = Column(Boolean, default=True)
    created_at   = Column(DateTime(timezone=True), server_default=func.now())