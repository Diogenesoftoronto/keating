/** Error types thrown by course operations; the HTTP layer maps them to status codes. */

export class CourseAuthorizationError extends Error {
  readonly code = "course_forbidden";
}

export class CourseConflictError extends Error {
  readonly code = "course_conflict";
  constructor(
    message: string,
    readonly currentRevision: number,
  ) {
    super(message);
  }
}

export class CourseNotFoundError extends Error {
  readonly code = "course_not_found";
}
