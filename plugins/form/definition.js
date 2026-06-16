// MCP tool definition for presentForm. Note the round-trip is NOT a blocking MCP
// call: the form renders, the user submits, and their answer is typed back into
// the PTY as the next user turn (the same GUI->LLM mechanism MulmoClaude uses).
// So the description tells claude to simply wait for the user's next message.
import { z } from "zod";

const fieldSchema = z.object({
  name: z.string().describe("Key this field's value appears under in the answer."),
  label: z.string().optional().describe("Human-readable label (defaults to name)."),
  type: z
    .enum(["text", "textarea", "number", "select"])
    .optional()
    .describe("Control type (default: text)."),
  options: z.array(z.string()).optional().describe("Choices for a 'select' field."),
  placeholder: z.string().optional(),
  required: z.boolean().optional(),
});

export const DEFINITION = {
  title: "Present Form",
  description:
    "Ask the user for structured input via a form in the GUI panel, instead of " +
    "free-text in the terminal. The form renders beside the terminal; when the user " +
    "submits, their answers arrive as your next user message. After calling this, " +
    "wait for that message before continuing.",
  inputSchema: {
    title: z.string().optional().describe("Heading shown above the form."),
    fields: z.array(fieldSchema).min(1).describe("The fields to collect."),
    submitLabel: z.string().optional().describe("Label for the submit button."),
  },
};
