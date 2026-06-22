package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"

	ax "github.com/ax-llm/ax/packages/go"
)

// audio_http_roundtrip drives transcribe() and speak() through the REAL
// HTTPTransport against an in-process loopback server. Unlike the
// ScriptedTransport examples, this exercises the wire-level encoders that the
// conformance harness bypasses: the multipart/form-data request body for
// transcribe and the binary (non-UTF8) response handling for speak. It panics
// on any mismatch so `axir verify` fails if either regresses.
func main() {
	// Deliberately non-UTF8 bytes so a UTF-8/JSON decode regression on the
	// binary path corrupts them detectably.
	audioBytes := []byte{0x00, 0x01, 0x02, 0xff, 0xfe, 0x10, 0x7f}
	audioB64 := base64.StdEncoding.EncodeToString(audioBytes)
	speechBytes := []byte{0xff, 0xd8, 0xff, 0x00, 0x11, 0x22, 0xfe}
	wantAudio := base64.StdEncoding.EncodeToString(speechBytes)

	sawMultipart := false
	var gotFileBytes []byte

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.Contains(r.URL.Path, "transcriptions"):
			mediaType, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
			if err != nil || mediaType != "multipart/form-data" {
				panic("transcribe request was not multipart/form-data, got: " + r.Header.Get("Content-Type"))
			}
			sawMultipart = true
			mr := multipart.NewReader(r.Body, params["boundary"])
			for {
				part, perr := mr.NextPart()
				if perr != nil {
					break
				}
				if part.FormName() == "file" {
					gotFileBytes, _ = io.ReadAll(part)
				}
			}
			w.Header().Set("Content-Type", "application/json")
			io.WriteString(w, `{"text":"hello world","language":"en","duration":1.25}`)
		case strings.Contains(r.URL.Path, "speech"):
			w.Header().Set("Content-Type", "audio/mpeg")
			w.Write(speechBytes)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	client := ax.NewOpenAIResponsesClient(map[string]ax.Value{
		"api_key":  "test-key",
		"base_url": server.URL,
	})

	transcript, err := client.Transcribe(context.Background(), map[string]ax.Value{
		"audio": audioB64, "language": "en", "model": "gpt-4o-mini-transcribe", "format": "json",
	}, nil)
	if err != nil {
		panic(err)
	}
	if !sawMultipart {
		panic("loopback server never received a multipart transcribe request")
	}
	if got := base64.StdEncoding.EncodeToString(gotFileBytes); got != audioB64 {
		panic(fmt.Sprintf("multipart file bytes mismatch: got %s want %s", got, audioB64))
	}
	if data, _ := json.Marshal(transcript); !strings.Contains(string(data), "hello world") {
		panic("transcribe response not normalized: " + string(data))
	}

	speech, err := client.Speak(context.Background(), map[string]ax.Value{
		"text": "hello", "voice": "alloy", "format": "mp3", "model": "gpt-4o-mini-tts",
	}, nil)
	if err != nil {
		panic(err)
	}
	if data, _ := json.Marshal(speech); !strings.Contains(string(data), wantAudio) {
		panic("speak binary response not base64-encoded as expected: " + string(data))
	}

	fmt.Println("audio-http-roundtrip-ok")
}
