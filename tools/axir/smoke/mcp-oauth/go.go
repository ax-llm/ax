package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"

	ax "github.com/ax-llm/ax/packages/go"
)

type tokenStore struct{ values map[string]ax.AxMCPTokenSet }

func (s *tokenStore) GetToken(key string) (*ax.AxMCPTokenSet, error) {
	token, ok := s.values[key]
	if !ok { return nil, nil }
	return &token, nil
}
func (s *tokenStore) SetToken(key string, token ax.AxMCPTokenSet) error { s.values[key] = token; return nil }
func (s *tokenStore) ClearToken(key string) error { delete(s.values, key); return nil }

func main() {
	endpoint := os.Getenv("AX_MCP_ENDPOINT")
	expectedError := os.Getenv("AX_MCP_EXPECT_ERROR")
	protection := map[string]ax.Value{"requireHttps": false, "allowLocalhost": true, "allowPrivateNetworks": true}
	transport, err := ax.NewAxMCPStreamableHTTPTransport(endpoint, map[string]ax.Value{"ssrfProtection": protection})
	if err != nil { panic(err) }
	transport.OAuth = &ax.AxMCPOAuthOptions{
		ClientID: "ax-port-client", RedirectURI: "http://localhost:8787/callback",
		Scopes: []string{"mcp:read"}, RequireIss: true, SSRFProtection: protection,
		TokenStore: &tokenStore{values: map[string]ax.AxMCPTokenSet{}},
		OnAuthCode: func(url string) (map[string]string, error) {
			response, err := http.Get(url); if err != nil { return nil, err }; defer response.Body.Close()
			var value map[string]string; err = json.NewDecoder(response.Body).Decode(&value); return value, err
		},
	}
	err = run(transport)
	if expectedError != "" {
		if err == nil || !strings.Contains(strings.ToLower(err.Error()), strings.ToLower(expectedError)) { panic(fmt.Sprintf("expected %q error, got %v", expectedError, err)) }
		fmt.Println("AX_MCP_OAUTH_EXPECTED_ERROR")
		return
	}
	if err != nil { panic(err) }
	fmt.Println("AX_MCP_OAUTH_OK")
}

func run(transport *ax.AxMCPStreamableHTTPTransport) error {
	for id, method := range []string{"initialize", "tools/list"} {
		_, err := transport.Send(map[string]ax.Value{"jsonrpc": "2.0", "id": id + 1, "method": method, "params": map[string]ax.Value{}})
		if err != nil { return fmt.Errorf("%s: %w", method, err) }
	}
	return nil
}
