import { describe, expect, it } from "vitest";
import {
  BlockedColumnError,
  assertColumnAllowed,
  dropBlockedColumns,
  isBlockedColumn,
  partitionColumns,
} from "./columns";

describe("isBlockedColumn", () => {
  it.each([
    "email",
    "Email",
    "EMAIL_ADDRESS",
    "e-mail",
    "emailAddress",
    "contact_email",
    "name",
    "Name",
    "first_name",
    "FirstName",
    "last name",
    "full_name",
    "customer_name",
    "phone",
    "phone_number",
    "Mobile",
    "telephone",
    "address",
    "street_address",
    "address_line_1",
    "billing_address",
    "zip_code",
    "ssn",
  ])("blocks %s", (col) => {
    expect(isBlockedColumn(col)).toBe(true);
  });

  it.each([
    "comment",
    "feedback",
    "review_text",
    "survey_response",
    "campaign_name",
    "product_name",
    "quote",
    "created_at",
  ])("allows %s", (col) => {
    expect(isBlockedColumn(col)).toBe(false);
  });

  it("blocks an empty or blank column name (fail closed)", () => {
    expect(isBlockedColumn("")).toBe(true);
    expect(isBlockedColumn("   ")).toBe(true);
  });
});

describe("partitionColumns", () => {
  it("splits allowed and blocked, keeping order", () => {
    expect(partitionColumns(["comment", "email", "score", "first_name"])).toEqual({
      allowed: ["comment", "score"],
      blocked: ["email", "first_name"],
    });
  });
});

describe("dropBlockedColumns", () => {
  it("removes identity columns from a row", () => {
    expect(
      dropBlockedColumns({ comment: "ok", email: "x@example.com", score: 5, phone: "1" }),
    ).toEqual({ comment: "ok", score: 5 });
  });
});

describe("assertColumnAllowed", () => {
  it("throws BlockedColumnError for an identity column", () => {
    expect(() => assertColumnAllowed("email")).toThrow(BlockedColumnError);
  });

  it("does not throw for an allowed column", () => {
    expect(() => assertColumnAllowed("comment")).not.toThrow();
  });
});
