export function createFakeTransport(script = []) {
  const queue = [...script];
  const calls = [];

  return {
    calls,
    async send(request) {
      calls.push({
        agentId: request.agentId,
        harness: request.harness,
        requestId: request.requestId,
        payload: request.payload,
        attempt: request.attempt,
        proxyConfig: request.proxyConfig
      });

      if (queue.length === 0) {
        throw new Error("fake transport script exhausted");
      }
      const step = queue.shift();
      if (typeof step === "function") {
        return step(request);
      }
      if (step && typeof step === "object" && step.type === "throw") {
        const error = new Error(step.message ?? "fake transport failure");
        error.code = step.code ?? "FAKE_TRANSPORT_ERROR";
        error.retryable = step.retryable ?? false;
        throw error;
      }
      return step;
    }
  };
}
