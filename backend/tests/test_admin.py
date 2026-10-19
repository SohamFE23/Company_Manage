def test_non_admin_cannot_access_admin_api(client, auth_headers):
    assert client.get(
        "/api/admin/users", headers=auth_headers["member"]
    ).status_code == 403


def test_admin_cannot_deactivate_self(client, actors, auth_headers):
    admin_id = actors["users"]["admin"].id
    response = client.patch(
        f"/api/admin/users/{admin_id}",
        headers=auth_headers["admin"],
        json={"is_active": False},
    )

    assert response.status_code == 409


def test_last_active_admin_cannot_be_demoted_or_deactivated(
    client, actors, auth_headers
):
    admin_id = actors["users"]["admin"].id
    demote = client.patch(
        f"/api/admin/users/{admin_id}",
        headers=auth_headers["admin"],
        json={"is_admin": False},
    )
    deactivate = client.patch(
        f"/api/admin/users/{admin_id}",
        headers=auth_headers["admin"],
        json={"is_active": False},
    )

    assert demote.status_code == 409
    assert deactivate.status_code == 409
