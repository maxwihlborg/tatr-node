import { Schema } from "effect";
import { TaskWithBody, type Task } from "../schema.js";

/**
 * A task as a tool answers with it, which is a task without its `stat` or its
 * body: an agent listing tasks wants to know what is there, and asks for the
 * one it picks.
 */
export class TaskSummary extends Schema.Opaque<TaskSummary>()(
  Schema.Struct({
    id: Schema.String,
    file: Schema.String,
    title: Schema.String,
    priority: Schema.Int,
    tags: Schema.Array(Schema.String),
    closed: Schema.Boolean,
  }),
) {
  static of(task: Task): TaskSummary {
    return TaskSummary.make({
      id: task.id,
      file: task.file,
      title: task.info.title,
      priority: task.info.priority,
      tags: task.info.tags,
      closed: task.info.closed,
    });
  }
}

/**
 * A task as the tool reading one answers with it. The field is only here
 * because `TaskWithBody` is also what the parser hands back, and nothing on
 * disk knows who points at a task.
 */
export class TaskDetail extends Schema.Opaque<TaskDetail>()(
  Schema.Struct({
    ...TaskWithBody.fields,
    references: Schema.Array(Schema.String).annotate({
      description:
        "Absolute paths of the files mentioning this id, " +
        "normally the marker comment the task was made from",
    }),
  }),
) {
  static of(task: TaskWithBody, references: ReadonlyArray<string>): TaskDetail {
    return TaskDetail.make({ ...task, references });
  }
}

/**
 * What a tool tells the client when it cannot answer. Only the `message` of a
 * failure reaches the agent, everything else it is handed reads as an internal
 * server error, so every reason we have is spelled out here.
 */
export class TaskToolError extends Schema.TaggedError<TaskToolError>()("TaskToolError", {
  message: Schema.String,
}) {}
