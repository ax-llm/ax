package dev.axllm.ax;

/** Terminal provider error produced when the caller cancels an operation. */
public final class AxAIServiceAbortedError extends AxAIServiceError {
  private final String reason;
  public AxAIServiceAbortedError(String reason){
    super(reason==null||reason.isBlank()||reason.equals("cancelled")?"Request aborted":"Request aborted: "+reason,null,null,null,null,false);
    this.reason=reason;
  }
  public String reason(){return reason;}
}
