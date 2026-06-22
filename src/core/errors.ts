export type ArxivErrorCode =
  | "GENERIC"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "NETWORK"
  | "PARSE"
  | "UNSUPPORTED";

export class ArxivError extends Error {
  readonly code: ArxivErrorCode;
  constructor(message: string, code: ArxivErrorCode = "GENERIC") {
    super(message);
    this.name = new.target.name;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NotFoundError extends ArxivError {
  constructor(message: string) {
    super(message, "NOT_FOUND");
  }
}

export class RateLimitedError extends ArxivError {
  constructor(message: string) {
    super(message, "RATE_LIMITED");
  }
}

export class NetworkError extends ArxivError {
  constructor(message: string) {
    super(message, "NETWORK");
  }
}

export class ParseError extends ArxivError {
  constructor(message: string) {
    super(message, "PARSE");
  }
}

export class UnsupportedError extends ArxivError {
  constructor(message: string) {
    super(message, "UNSUPPORTED");
  }
}

/** Stable CLI exit codes (spec §11). */
export function exitCodeFor(err: unknown): number {
  if (err instanceof ArxivError) {
    switch (err.code) {
      case "NOT_FOUND":
        return 2;
      case "RATE_LIMITED":
        return 3;
      case "NETWORK":
        return 4;
      case "PARSE":
        return 5;
      case "UNSUPPORTED":
        return 6;
      default:
        return 1;
    }
  }
  return 1;
}
