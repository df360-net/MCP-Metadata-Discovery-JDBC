import { mapDataType } from "../src/ingestion/dtype-mapping.js";

describe("Data Type Mapping", () => {
  describe("integer types", () => {
    it.each([
      ["int", "DTYPE-INTEGER"],
      ["int4", "DTYPE-INTEGER"],
      ["int8", "DTYPE-INTEGER"],
      ["bigint", "DTYPE-INTEGER"],
      ["smallint", "DTYPE-INTEGER"],
      ["tinyint", "DTYPE-INTEGER"],
      ["integer", "DTYPE-INTEGER"],
      ["serial", "DTYPE-INTEGER"],
      ["bigserial", "DTYPE-INTEGER"],
      ["int64", "DTYPE-INTEGER"],
      ["byteint", "DTYPE-INTEGER"],
    ])("maps %s to %s", (input, expected) => {
      expect(mapDataType(input)).toBe(expected);
    });
  });

  describe("numeric types", () => {
    it.each([
      ["numeric", "DTYPE-NUMERIC"],
      ["decimal", "DTYPE-NUMERIC"],
      ["float", "DTYPE-NUMERIC"],
      ["double", "DTYPE-NUMERIC"],
      ["real", "DTYPE-NUMERIC"],
      ["money", "DTYPE-NUMERIC"],
      ["float64", "DTYPE-NUMERIC"],
      ["number", "DTYPE-NUMERIC"],
    ])("maps %s to %s", (input, expected) => {
      expect(mapDataType(input)).toBe(expected);
    });
  });

  describe("string types", () => {
    it.each([
      ["varchar", "DTYPE-VARCHAR"],
      ["nvarchar", "DTYPE-VARCHAR"],
      ["varchar2", "DTYPE-VARCHAR"],
      ["string", "DTYPE-VARCHAR"],
      ["char", "DTYPE-CHAR"],
      ["nchar", "DTYPE-CHAR"],
      ["text", "DTYPE-TEXT"],
      ["clob", "DTYPE-TEXT"],
      ["longtext", "DTYPE-TEXT"],
    ])("maps %s to %s", (input, expected) => {
      expect(mapDataType(input)).toBe(expected);
    });
  });

  describe("boolean types", () => {
    it.each([
      ["boolean", "DTYPE-BOOLEAN"],
      ["bool", "DTYPE-BOOLEAN"],
      ["bit", "DTYPE-BOOLEAN"],
    ])("maps %s to %s", (input, expected) => {
      expect(mapDataType(input)).toBe(expected);
    });
  });

  describe("date/time types", () => {
    it.each([
      ["date", "DTYPE-DATE"],
      ["datetime", "DTYPE-TIMESTAMP"],
      ["timestamp", "DTYPE-TIMESTAMP"],
      ["timestamptz", "DTYPE-TIMESTAMP"],
      ["datetime2", "DTYPE-TIMESTAMP"],
      ["time", "DTYPE-TIMESTAMP"],
    ])("maps %s to %s", (input, expected) => {
      expect(mapDataType(input)).toBe(expected);
    });
  });

  describe("binary types", () => {
    it.each([
      ["binary", "DTYPE-BINARY"],
      ["varbinary", "DTYPE-BINARY"],
      ["blob", "DTYPE-BINARY"],
      ["bytea", "DTYPE-BINARY"],
    ])("maps %s to %s", (input, expected) => {
      expect(mapDataType(input)).toBe(expected);
    });
  });

  describe("json/xml/structured types", () => {
    it.each([
      ["json", "DTYPE-VARCHAR"],
      ["jsonb", "DTYPE-VARCHAR"],
      ["xml", "DTYPE-VARCHAR"],
      ["uuid", "DTYPE-VARCHAR"],
      ["variant", "DTYPE-VARCHAR"],
    ])("maps %s to %s", (input, expected) => {
      expect(mapDataType(input)).toBe(expected);
    });
  });

  describe("precision stripping", () => {
    it("strips varchar(255) to varchar", () => {
      expect(mapDataType("varchar(255)")).toBe("DTYPE-VARCHAR");
    });

    it("strips numeric(10,2) to numeric", () => {
      expect(mapDataType("numeric(10,2)")).toBe("DTYPE-NUMERIC");
    });

    it("strips int(11) to int", () => {
      expect(mapDataType("int(11)")).toBe("DTYPE-INTEGER");
    });
  });

  describe("case insensitivity", () => {
    it("handles uppercase", () => {
      expect(mapDataType("VARCHAR")).toBe("DTYPE-VARCHAR");
    });

    it("handles mixed case", () => {
      expect(mapDataType("BigInt")).toBe("DTYPE-INTEGER");
    });
  });

  describe("unknown types", () => {
    it("falls back to DTYPE-VARCHAR for unknown types", () => {
      expect(mapDataType("some_custom_type")).toBe("DTYPE-VARCHAR");
    });
  });
});
