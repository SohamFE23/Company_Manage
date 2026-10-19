import { describe, expect, it } from "vitest";
import { ApiError } from "./api";

describe("ApiError", () => {
  it("uses a string detail as the message", () => {
    const error = new ApiError("Not allowed", 403);

    expect(error.message).toBe("Not allowed");
    expect(error.status).toBe(403);
    expect(error.detail).toBe("Not allowed");
  });

  it("formats FastAPI validation errors", () => {
    const error = new ApiError(
      [{ loc: ["body", "email"], msg: "Invalid email" }],
      422,
    );

    expect(error.message).toBe("body.email: Invalid email");
  });

  it("formats optimistic-lock conflict details and keeps the detail", () => {
    const detail = {
      message: "This item was changed by someone else.",
      current_version: 8,
    };
    const error = new ApiError(detail, 409);

    expect(error.message).toBe(detail.message);
    expect(error.status).toBe(409);
    expect(error.detail).toEqual(detail);
  });
});
