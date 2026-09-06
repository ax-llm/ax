package dev.axllm.ax;

import java.util.Map;

public interface AiClient {
  Map<String, Object> complete(Map<String, Object> request) throws Exception;

  default Map<String, Object> chat(Map<String, Object> request) throws Exception {
    return Core.legacyResponseToChatResponse(complete(request));
  }

  default Map<String, Object> chat(Map<String, Object> request, AxCancellationToken cancellation) throws Exception {
    if(cancellation!=null)cancellation.throwIfCancelled();
    Map<String,Object> response=chat(request);
    if(cancellation!=null)cancellation.throwIfCancelled();
    return response;
  }

  default Iterable<Map<String, Object>> stream(Map<String, Object> request) throws Exception {
    return AxChatStream.lazy(() -> AxChatStream.fromIterable(java.util.List.of(chat(request))));
  }

  default Iterable<Map<String, Object>> stream(Map<String, Object> request, AxCancellationToken cancellation) throws Exception {
    return openStream(request,cancellation);
  }

  default AxChatStream openStream(Map<String, Object> request) throws Exception {
    Iterable<Map<String, Object>> values = stream(request);
    return values instanceof AxChatStream chatStream ? chatStream : AxChatStream.fromIterable(values);
  }

  default AxChatStream openStream(Map<String, Object> request,AxCancellationToken cancellation)throws Exception{
    if(cancellation!=null)cancellation.throwIfCancelled();
    AxChatStream source=openStream(request);
    java.util.Iterator<Map<String,Object>> iterator=source.iterator();
    AxCancellationToken.Subscription subscription=cancellation==null?()->{}:cancellation.subscribe(source::close);
    return new AxChatStream(()->{if(cancellation!=null)cancellation.throwIfCancelled();return iterator.hasNext()?iterator.next():null;},()->{subscription.close();source.close();});
  }

  default Map<String, Object> transcribe(Map<String, Object> request, Map<String, Object> options) throws Exception {
    return Map.of("text", "");
  }

  default Map<String,Object> transcribe(Map<String,Object> request,Map<String,Object> options,AxCancellationToken cancellation)throws Exception{if(cancellation!=null)cancellation.throwIfCancelled();return transcribe(request,options);}
}
