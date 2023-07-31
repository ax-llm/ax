// Example POST method implementation:
async function postData(url = "", data = {}) {
  // Default options are marked with *
  const response = await fetch(url, {
    method: "POST", // *GET, POST, PUT, DELETE, etc.
    headers: {
      "Content-Type": "application/json",
      'Authorization': "Bearer OQ1ijL35gTEbFCtON4fAFbJieZOrSi7xktLYpR5I"
      // 'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: JSON.stringify(data), // body data type must match "Content-Type" header
  });
  return response.json(); // parses JSON response into native JavaScript objects
}

postData("https://api.cohere.ai/v1/tokenize", {
	model: "command-nightly",
	text: "{ 'hello': 'world' }"
}).then((data) => {
  console.log(data); // JSON data parsed by `data.json()` call
});
