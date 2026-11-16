/**
 * Error messages are written for the person using the screen. They never
 * include text from the file, because file text is customer data.
 */

export class EmptyFileError extends Error {
  constructor() {
    super("The file is empty. Choose a CSV file that has a header row.");
    this.name = "EmptyFileError";
  }
}

export class TooManyColumnsError extends Error {
  constructor(public readonly limit: number) {
    super(`The file has more than ${limit} columns. Remove unused columns and try again.`);
    this.name = "TooManyColumnsError";
  }
}

export type OtherDelimiter = ";" | "\t" | "|";

const DELIMITER_WORDS: Record<OtherDelimiter, string> = {
  ";": "semicolons",
  "\t": "tabs",
  "|": "pipes",
};

export class UnsupportedDelimiterError extends Error {
  constructor(public readonly delimiter: OtherDelimiter) {
    super(
      `This file looks like it is separated by ${DELIMITER_WORDS[delimiter]}, but only commas are supported. ` +
        "Save it as a comma separated CSV and try again.",
    );
    this.name = "UnsupportedDelimiterError";
  }
}

export class CsvParseError extends Error {
  constructor(
    message: string,
    public readonly line: number | null = null,
  ) {
    super(message);
    this.name = "CsvParseError";
  }
}

export class MappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MappingError";
  }
}

export class NotOpenError extends Error {
  constructor() {
    super("Open a file before loading it.");
    this.name = "NotOpenError";
  }
}

export class NotLoadedError extends Error {
  constructor() {
    super("Load the file before previewing it.");
    this.name = "NotLoadedError";
  }
}
