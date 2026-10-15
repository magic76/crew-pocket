'use strict';

// Older providers emit error only when closing. Explicit nonterminal/retry
// metadata takes precedence; a warning must never release a running turn.
function isTerminalProviderError(event) {
  return event?.type === 'error' && event.terminal !== false && event.retryable !== true;
}

module.exports = { isTerminalProviderError };
