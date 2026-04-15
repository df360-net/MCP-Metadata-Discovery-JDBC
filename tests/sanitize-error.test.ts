import { sanitizeErrorMessage } from "../src/discovery/types.js";

describe("sanitizeErrorMessage", () => {
  it("strips password= from error messages", () => {
    const result = sanitizeErrorMessage(new Error("Connection failed password=secret123 at host"));
    expect(result).not.toContain("secret123");
    expect(result).toContain("password=*****");
  });

  it("strips user:pass@host patterns", () => {
    const result = sanitizeErrorMessage(new Error("ECONNREFUSED postgres:mypass@localhost:5432"));
    expect(result).not.toContain("mypass");
    expect(result).toContain("*****@");
  });

  it("strips pwd= patterns", () => {
    const result = sanitizeErrorMessage(new Error("auth failed pwd=s3cret"));
    expect(result).not.toContain("s3cret");
    expect(result).toContain("pwd=*****");
  });

  it("passes through clean error messages unchanged", () => {
    const result = sanitizeErrorMessage(new Error("Connection timed out after 10000ms"));
    expect(result).toBe("Connection timed out after 10000ms");
  });

  it("handles non-Error inputs", () => {
    const result = sanitizeErrorMessage("string error password=secret");
    expect(result).not.toContain("secret");
    expect(result).toContain("password=*****");
  });
});
