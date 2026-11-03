#!/usr/bin/env python
"""Promote an existing account to admin (or demote it).

Usage (from backend/):
    python -m scripts.make_admin --email you@example.com
    python -m scripts.make_admin --email you@example.com --role student
    python -m scripts.make_admin --list

The account must already exist (register in the mobile app or Supabase first).
The script works with both the SQLite dev database and Supabase PostgreSQL.
"""
from __future__ import annotations

import argparse
import asyncio
import sys

from sqlalchemy import func, select

from app.db.base import SessionLocal, init_db
from app.db.models import User

# Windows console mặc định cp1252 sẽ lỗi khi in tiếng Việt.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", help="Email of the account to update")
    parser.add_argument(
        "--role",
        choices=["admin", "student"],
        default="admin",
        help="Role to assign (default: admin)",
    )
    parser.add_argument(
        "--list", action="store_true", help="List existing accounts and roles"
    )
    args = parser.parse_args()

    if not args.list and not args.email:
        parser.error("--email is required unless --list is used")

    await init_db()
    async with SessionLocal() as db:
        if args.list:
            rows = (
                await db.execute(
                    select(User.email, User.name, User.role).order_by(User.created_at)
                )
            ).all()
            if not rows:
                print("Chưa có tài khoản nào.")
                return 1
            for email, name, role in rows:
                print(f"{role:7}  {email:40}  {name}")
            return 0

        email = args.email.strip().lower()
        user = await db.scalar(
            select(User).where(func.lower(User.email) == email)
        )
        if user is None:
            print(f"Không tìm thấy tài khoản {email}. Hãy đăng ký trong app trước.")
            return 1

        user.role = args.role
        await db.commit()
        print(f"Đã đặt {user.email} thành role={user.role}.")
        print("Đăng xuất rồi đăng nhập lại trên Admin Web để nhận quyền mới.")
        return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
