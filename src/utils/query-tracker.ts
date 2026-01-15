/**
 * Utility for tracking costs and processing messages from Claude Agent SDK query streams.
 */

interface QueryTrackerResult {
  totalCost: number;
  stepCount: number;
}

interface QueryTrackerCallbacks {
  onAssistantMessage?: (message: any) => void;
  onBudgetExceeded?: () => void;
}

/**
 * Process query stream messages and track costs.
 * Returns final cost and step count after stream completes.
 *
 * @param queryStream - Async iterator from query()
 * @param callbacks - Optional callbacks for message processing
 * @returns Total cost and step count
 */
export async function trackQuery(
  queryStream: AsyncIterableIterator<any>,
  callbacks: QueryTrackerCallbacks = {}
): Promise<QueryTrackerResult> {
  let totalCost = 0;
  let stepCount = 0;

  for await (const message of queryStream) {
    // Capture final result with authoritative total cost
    // Per SDK docs: total_cost_usd is a direct property on SDKResultMessage
    if (message.type === "result" && "total_cost_usd" in message) {
      totalCost = message.total_cost_usd as number;
    }

    // Debug: Log assistant message activity
    if (message.type === "assistant" && "message" in message && message.message) {
      const assistantMsg = message.message as any;
      if (assistantMsg.id && assistantMsg.usage) {
        stepCount++;
        console.log(`[DEBUG] Step ${stepCount} (${assistantMsg.id}): input=${assistantMsg.usage.input_tokens}, output=${assistantMsg.usage.output_tokens}`);
      }

      // Call custom assistant message handler if provided
      if (callbacks.onAssistantMessage) {
        callbacks.onAssistantMessage(message);
      }
    }

    // Handle budget exceeded error
    if (message.type === "error" && "error" in message &&
        typeof message.error === "object" && message.error !== null &&
        "type" in message.error && message.error.type === "budget_exceeded") {
      console.error("\n⚠️  Budget limit exceeded");
      if (callbacks.onBudgetExceeded) {
        callbacks.onBudgetExceeded();
      }
      process.exit(1);
    }
  }

  return { totalCost, stepCount };
}
