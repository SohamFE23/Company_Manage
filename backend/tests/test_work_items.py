from app.database import SessionLocal
from app.models import TeamMembership, WorkItem


def create_item(client, actors, auth_headers, title="Test work item", **extra):
    return client.post(
        "/api/work-items",
        headers=auth_headers["member"],
        json={"title": title, "team_id": actors["team_id"], **extra},
    )


def test_work_item_scope_hides_items_from_outsiders(client, actors, auth_headers):
    created = create_item(client, actors, auth_headers)
    item_id = created.json()["id"]

    assert client.get(
        f"/api/work-items/{item_id}", headers=auth_headers["outsider"]
    ).status_code == 404
    assert client.get(
        "/api/work-items", headers=auth_headers["outsider"]
    ).json()["total"] == 0
    assert client.get(
        "/api/work-items", headers=auth_headers["admin"]
    ).json()["total"] == 1


def test_viewer_cannot_create_or_edit_work_items(client, actors, auth_headers):
    create_response = client.post(
        "/api/work-items",
        headers=auth_headers["viewer"],
        json={"title": "Forbidden item", "team_id": actors["team_id"]},
    )
    assert create_response.status_code == 403

    created = create_item(client, actors, auth_headers)
    update_response = client.patch(
        f"/api/work-items/{created.json()['id']}",
        headers=auth_headers["viewer"],
        json={"title": "Changed title", "expected_version": 1},
    )
    assert update_response.status_code == 403


def test_assignee_must_be_active_team_member(client, actors, auth_headers):
    response = create_item(
        client,
        actors,
        auth_headers,
        assignee_id=actors["users"]["outsider"].id,
    )

    assert response.status_code == 422


def test_stale_version_conflicts_and_correct_version_increments(
    client, actors, auth_headers
):
    item = create_item(client, actors, auth_headers).json()
    path = f"/api/work-items/{item['id']}"

    first = client.patch(
        path,
        headers=auth_headers["member"],
        json={"title": "First update", "expected_version": 1},
    )
    stale = client.patch(
        path,
        headers=auth_headers["member"],
        json={"title": "Stale update", "expected_version": 1},
    )

    assert first.status_code == 200
    assert first.json()["version"] == 2
    assert stale.status_code == 409
    assert stale.json()["detail"]["current_version"] == 2


def test_changes_write_activity_for_status_priority_and_assignee(
    client, actors, auth_headers
):
    item = create_item(client, actors, auth_headers).json()
    updated = client.patch(
        f"/api/work-items/{item['id']}",
        headers=auth_headers["member"],
        json={
            "expected_version": 1,
            "status": "in_progress",
            "priority": "high",
            "assignee_id": actors["users"]["member"].id,
        },
    )

    assert updated.status_code == 200
    events = client.get(
        f"/api/work-items/{item['id']}/activity",
        headers=auth_headers["member"],
    ).json()
    assert {event["action"] for event in events} == {
        "created",
        "status_changed",
        "priority_changed",
        "assignee_changed",
    }
    assert all(event["actor_name"] for event in events)


def test_search_escapes_percent_wildcard(client, actors, auth_headers):
    literal = create_item(
        client, actors, auth_headers, title="literal % character"
    )
    create_item(client, actors, auth_headers, title="ordinary item")

    response = client.get(
        "/api/work-items?search=%25", headers=auth_headers["member"]
    )

    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["id"] == literal.json()["id"]


def test_last_manager_cannot_be_demoted_or_removed(client, actors, auth_headers):
    manager = actors["users"]["manager"]
    demote = client.patch(
        f"/api/teams/{actors['team_id']}/members/{manager.id}",
        headers=auth_headers["admin"],
        json={"role": "member"},
    )
    remove = client.delete(
        f"/api/teams/{actors['team_id']}/members/{manager.id}",
        headers=auth_headers["admin"],
    )

    assert demote.status_code == 409
    assert remove.status_code == 409


def test_removing_member_unassigns_work_and_bumps_version(
    client, actors, auth_headers
):
    member_id = actors["users"]["member"].id
    item = create_item(
        client, actors, auth_headers, assignee_id=member_id
    ).json()

    removed = client.delete(
        f"/api/teams/{actors['team_id']}/members/{member_id}",
        headers=auth_headers["manager"],
    )

    assert removed.status_code == 204
    with SessionLocal() as db:
        updated_item = db.get(WorkItem, item["id"])
        assert updated_item.assignee_id is None
        assert updated_item.version == item["version"] + 1
        assert db.scalar(
            select_membership(member_id, actors["team_id"])
        ) is None


def select_membership(user_id, team_id):
    from sqlalchemy import select

    return select(TeamMembership.id).where(
        TeamMembership.user_id == user_id,
        TeamMembership.team_id == team_id,
    )
