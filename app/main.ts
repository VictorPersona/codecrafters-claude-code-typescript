import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources";

async function main() {
  const [, , flag, prompt] = process.argv;
  const apiKey = process.env.OPENROUTER_API_KEY;
  const baseURL =
    process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }
  if (flag !== "-p" || !prompt) {
    throw new Error("error: -p flag is required");
  }

  const client = new OpenAI({
    apiKey: apiKey,
    baseURL: baseURL,
  });

  const message: ChatCompletionMessageParam[] = [
    { role: "user", content: prompt },
  ];
  async function ReadFile(file_path: string) {
    const fileToRead = Bun.file(file_path);
    const data = await fileToRead.text();
    return data;
  }
  const tools: Record<string, Function> = { Read: ReadFile };

  while (true) {
    const response = await client.chat.completions.create({
      model: "anthropic/claude-haiku-4.5",
      messages: message,
      tools: [
        {
          type: "function",
          function: {
            name: "Read",
            description: "Read and return the contents of a file",
            parameters: {
              type: "object",
              properties: {
                file_path: {
                  type: "string",
                  description: "The path to the file to read",
                },
              },
              required: ["file_path"],
            },
          },
        },
      ],
    });
    message.push({ role: "assistant", content: response.object });

    const tool_calls = response.choices[0].message.tool_calls;
    if (!tool_calls) {
      console.log(response.choices[0].message.content);
      break;
    }
    tool_calls.forEach((element) => {
      if (element.type == "function") {
        const toolToCall = tools[element.function.name];
        if (toolToCall) {
          const params = JSON.parse(element.function.arguments);
          const result = toolToCall(params);
          message.push({
            role: "tool",
            tool_call_id: element.id,
            content: result,
          });
        }
      }
    });
  }

  // if (!response.choices || response.choices.length === 0) {
  //   throw new Error("no choices in response");
  // }

  // You can use print statements as follows for debugging, they'll be visible when running tests.
  console.error("Logs from your program will appear here!");

  // TODO: Uncomment the lines below to pass the first stage

  // const toolCalls = response.choices[0].message.tool_calls;
  // if (toolCalls) {
  //   const firstToolCall = toolCalls[0];
  //   if (firstToolCall.type == "function") {
  //     if (firstToolCall.function.name == "Read") {
  //       const fileparams = JSON.parse(firstToolCall.function.arguments);
  //       if (fileparams.file_path) {
  //         const fileToRead = Bun.file(fileparams.file_path);
  //         const data = await fileToRead.text();
  //         console.log(data);
  //       }
  //     }
  //   }
  // } else {
  //   console.log(response.choices[0].message.content);
  // }
}

main();
