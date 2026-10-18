
from getpass import getpass

from sqlalchemy import select
from pwdlib import PasswordHash

from app.database import SessionLocal
from app.models import User

DEMO_EMAILS = [
    "admin@opsflow.local",
    "manager@opsflow.local",
    "employee@opsflow.local",
    "viewer@opsflow.local",
]

def main():
    password = getpass("Enter a new demo password (minimum 12 characters): ")
    if len(password) < 12:
        raise SystemExit("Password must contain at least 12 characters.")

    confirm = getpass("Confirm the new password: ")
    if password != confirm:
        raise SystemExit("Passwords do not match.")

    hasher = PasswordHash.recommended()

    with SessionLocal() as db:
        users = db.scalars(
            select(User).where(User.email.in_(DEMO_EMAILS))
        ).all()

        found_emails = {user.email.lower() for user in users}
        missing = set(DEMO_EMAILS) - found_emails

        if missing:
            raise SystemExit(
                "These accounts were not found in this database: "
                + ", ".join(sorted(missing))
                + ". Check backend/.env and the database connection."
            )

        for user in users:
            user.password_hash = hasher.hash(password)
            user.is_active = True

        db.commit()

    print(f"Success: reset passwords for {len(users)} demo accounts.")

if __name__ == "__main__":
    main()
