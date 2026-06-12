package dev.axllm.ax;

public class AxAIServiceError extends RuntimeException {
  public final Integer status;
  public final String code;
  public final Object responseBody;
  public final Object request;
  public final boolean retryable;

  public AxAIServiceError(String message) { this(message, null, null, null, null, false); }
  public AxAIServiceError(String message, Integer status, String code, Object responseBody, Object request, boolean retryable) {
    super(message);
    this.status = status;
    this.code = code;
    this.responseBody = responseBody;
    this.request = request;
    this.retryable = retryable;
  }
}

class AxAIServiceStatusError extends AxAIServiceError {
  AxAIServiceStatusError(String message, Integer status, String code, Object responseBody, Object request, boolean retryable) { super(message, status, code, responseBody, request, retryable); }
}
class AxAIServiceNetworkError extends AxAIServiceError { AxAIServiceNetworkError(String message) { super(message); } }
class AxAIServiceResponseError extends AxAIServiceError {
  AxAIServiceResponseError(String message) { super(message); }
  AxAIServiceResponseError(String message, Object responseBody) { super(message, null, null, responseBody, null, false); }
}
class AxAIServiceStreamTerminatedError extends AxAIServiceError {
  AxAIServiceStreamTerminatedError(String message, Object responseBody, boolean retryable) { super(message, null, null, responseBody, null, retryable); }
}
class AxAIServiceTimeoutError extends AxAIServiceError {
  AxAIServiceTimeoutError(String message, Integer status, String code, Object responseBody, Object request, boolean retryable) { super(message, status, code, responseBody, request, retryable); }
}
class AxAIServiceAuthenticationError extends AxAIServiceError {
  AxAIServiceAuthenticationError(String message, Integer status, String code, Object responseBody, Object request) { super(message, status, code, responseBody, request, false); }
}
class AxAIRefusalError extends AxAIServiceError { AxAIRefusalError(String message, Object responseBody) { super(message, null, null, responseBody, null, false); } }
class AxUnsupportedCapabilityError extends AxAIServiceError { AxUnsupportedCapabilityError(String message) { super(message); } }
