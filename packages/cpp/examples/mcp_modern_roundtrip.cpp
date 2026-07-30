#include "axllm/axllm.hpp"
#include "axllm/mcp.hpp"

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cctype>
#include <iostream>
#include <memory>
#include <string>
#include <thread>
#include <vector>

namespace {
std::string read_request(int fd) {
  std::string buf; char tmp[4096]; size_t end=std::string::npos, length=0;
  while (true) {
    if (end==std::string::npos) { auto pos=buf.find("\r\n\r\n"); if(pos!=std::string::npos){end=pos+4;std::string headers=buf.substr(0,end);std::string lower=headers;for(char& c:lower)c=static_cast<char>(std::tolower(static_cast<unsigned char>(c)));auto at=lower.find("content-length:");if(at!=std::string::npos)length=std::stoul(lower.substr(at+15));} }
    if(end!=std::string::npos&&buf.size()>=end+length)break;
    auto count=recv(fd,tmp,sizeof(tmp),0);if(count<=0)break;buf.append(tmp,static_cast<size_t>(count));
  }
  return buf;
}
void respond(int fd,const std::string& body){std::string out="HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: "+std::to_string(body.size())+"\r\nConnection: close\r\n\r\n"+body;size_t offset=0;while(offset<out.size()){auto count=send(fd,out.data()+offset,out.size()-offset,0);if(count<=0)break;offset+=static_cast<size_t>(count);}}
}

int main() {
  int server_fd=socket(AF_INET,SOCK_STREAM,0);int opt=1;setsockopt(server_fd,SOL_SOCKET,SO_REUSEADDR,&opt,sizeof(opt));
  sockaddr_in address{};address.sin_family=AF_INET;address.sin_addr.s_addr=htonl(INADDR_LOOPBACK);address.sin_port=0;
  if(bind(server_fd,reinterpret_cast<sockaddr*>(&address),sizeof(address))<0||listen(server_fd,8)<0)return 1;
  socklen_t size=sizeof(address);getsockname(server_fd,reinterpret_cast<sockaddr*>(&address),&size);int port=ntohs(address.sin_port);
  int calls=0,tool_lists=0;std::vector<std::string> failures;
  std::thread server([&]{
    bool done=false;while(!done){int fd=accept(server_fd,nullptr,nullptr);if(fd<0)return;std::string request=read_request(fd);++calls;
      std::string method=request.find("server/discover")!=std::string::npos?"server/discover":request.find("tools/list")!=std::string::npos?"tools/list":request.find("tasks/get")!=std::string::npos?"tasks/get":request.find("start_reindex")!=std::string::npos?"start_reindex":request.find("mrtr_roots_round")!=std::string::npos?"mrtr_roots_round":request.find("initialize")!=std::string::npos?"initialize":"unknown";
      if(method=="initialize")failures.push_back("modern client sent initialize");if(method!="server/discover"&&request.find("io.modelcontextprotocol")==std::string::npos)failures.push_back(method+" omitted request _meta");
      std::string meta="\"_meta\":{\"io.modelcontextprotocol/serverInfo\":{\"name\":\"modern-loopback\",\"version\":\"1.0."+std::to_string(calls)+"\"}}";
      std::string result;
      if(method=="server/discover")result="{\"resultType\":\"complete\",\"supportedVersions\":[\"2026-07-28\"],\"capabilities\":{\"tools\":{},\"extensions\":{\"io.modelcontextprotocol/tasks\":{}}},\"ttlMs\":60000,\"cacheScope\":\"public\","+meta+"}";
      else if(method=="tools/list"){++tool_lists;result="{\"resultType\":\"complete\",\"tools\":[{\"name\":\"start_reindex\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"scope\":{\"type\":\"string\",\"x-mcp-header\":\"Scope\"}}}},{\"name\":\"mrtr_roots_round\",\"inputSchema\":{\"type\":\"object\",\"properties\":{}}}],\"ttlMs\":60000,\"cacheScope\":\"public\","+meta+"}";}
      else if(method=="start_reindex"){std::string lower=request;for(char& c:lower)c=static_cast<char>(std::tolower(static_cast<unsigned char>(c)));if(lower.find("mcp-param-scope: all")==std::string::npos)failures.push_back("Mcp-Param-Scope was not propagated");result="{\"resultType\":\"task\",\"taskId\":\"task-1\",\"status\":\"working\",\"createdAt\":\"2026-07-29T00:00:00Z\",\"lastUpdatedAt\":\"2026-07-29T00:00:00Z\",\"ttlMs\":null,"+meta+"}";}
      else if(method=="tasks/get")result="{\"taskId\":\"task-1\",\"status\":\"completed\",\"createdAt\":\"2026-07-29T00:00:00Z\",\"lastUpdatedAt\":\"2026-07-29T00:00:01Z\",\"ttlMs\":null,\"result\":{\"resultType\":\"complete\",\"structuredContent\":{\"indexed\":42},"+meta+"},"+meta+"}";
      else if(request.find("requestState")==std::string::npos)result="{\"resultType\":\"input_required\",\"inputRequests\":{\"roots\":{\"method\":\"roots/list\"}},\"requestState\":\"opaque-roots-state\","+meta+"}";
      else {if(request.find("opaque-roots-state")==std::string::npos||request.find("file:///workspace")==std::string::npos)failures.push_back("roots MRTR response was not echoed");result="{\"resultType\":\"complete\",\"structuredContent\":{\"roots\":1},"+meta+"}";done=true;}
      respond(fd,"{\"jsonrpc\":\"2.0\",\"id\":"+std::to_string(calls)+",\"result\":"+result+"}");close(fd);
    }
  });

  auto transport=std::make_shared<axllm::AxMCPStreamableHTTPTransport>("http://127.0.0.1:"+std::to_string(port)+"/mcp",axllm::object({{"ssrfProtection",axllm::object({{"requireHttps",false},{"allowLocalhost",true},{"allowPrivateNetworks",true}})}}));
  axllm::AxMCPClient client(transport,axllm::object({{"era","modern"},{"roots",axllm::array({axllm::object({{"uri","file:///workspace"},{"name","workspace"}})})}}));
  client.init();if(client.get_era()!="modern")return 1;client.refresh(false);
  auto task=client.call_tool("start_reindex",axllm::object({{"scope","all"}}));if(axllm::Core::number(axllm::Core::get(axllm::Core::get(task,"structuredContent",axllm::Value::object()),"indexed",0))!=42)return 1;
  auto roots=client.call_tool("mrtr_roots_round",axllm::Value::object());if(axllm::Core::number(axllm::Core::get(axllm::Core::get(roots,"structuredContent",axllm::Value::object()),"roots",0))!=1)return 1;
  auto catalog=client.inspect_catalog(false);client.close();server.join();close(server_fd);
  if(tool_lists!=1||!failures.empty()||axllm::display(axllm::Core::get(catalog.server_info,"version",""))=="1.0.1"){std::cerr<<"modern roundtrip failed\n";return 1;}
  std::cout<<"mcp-modern-roundtrip-ok\n";return 0;
}
