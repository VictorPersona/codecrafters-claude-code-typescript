import { file } from "bun";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources";
import { exec } from "node:child_process";
import util from "node:util";
import { readdir } from "node:fs/promises";
import path from "node:path";
import fs from "node:fs/promises";
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

  async function ReadFile(fileparams: { file_path: string }) {
    const fileToRead = Bun.file(fileparams.file_path);
    const data = await fileToRead.text();
    return data;
  }

  async function WriteFile(writeFileParmas: {
    file_path: string;
    content: string;
  }): Promise<string> {
    const fileToWrite = Bun.file(writeFileParmas.file_path);
    await fileToWrite.write(writeFileParmas.content);
    const check = writeFileParmas.content === (await fileToWrite.text());
    return check ? "Write Successfull" : "Write Failed";
  }
  const newExec = util.promisify(exec);
  async function BashCall(bashCallParams: { command: string }) {
    const { stdout, stderr } = await newExec(bashCallParams.command);

    return JSON.stringify({ stdout, stderr });
  }

  const tools: Record<string, Function> = {
    Read: ReadFile,
    Write: WriteFile,
    Bash: BashCall,
  };
  const findSkill = async (file_path: string) => {
    const data = await ReadFile({ file_path });
    const first = data.indexOf("---");
    const second = data.indexOf("---", first + 3);
    const formatterText = data.slice(first + 3, second);
    const formatArray = formatterText.trim().split("\n");
    const finalObjArray = [];
    for (let index = 0; index < formatArray.length; index++) {
      const element = formatArray[index];
      const firstMark = element.indexOf(": ");
      finalObjArray.push([
        element.slice(0, firstMark),
        element.slice(firstMark + 1),
      ]);
    }
    const formatterObj = Object.fromEntries(finalObjArray);
    return formatterObj;
  };
  const skillsExists = async () => {
    try {
      await fs.stat(".claude/skills");
      return true;
    } catch (error) {
      return false;
    }
  };
  const findFolders = async () => {
    const skills = [];
    if (await skillsExists()) {
      const dirs = await readdir(".claude/skills", { withFileTypes: true });
      for (let index = 0; index < dirs.length; index++) {
        const element = dirs[index];
        if (element.isDirectory()) {
          const filePath = path.join(
            element.parentPath,
            element.name,
            "SKILL.md",
          );
          skills.push(await findSkill(filePath));
        }
      }
    }
    return skills;
  };

  const loadSkill = async (skillname: string) => {
    const skillpath = path.join(".claude/skills", skillname, "SKILL.md");
    const data = await ReadFile({ file_path: skillpath });
    const secondIndex = data.indexOf("---", 4);
    return data.slice(secondIndex + 3);
  };

  const skillNames: string[] = [];
  const advertiseSkills = async () => {
    const skills = await findFolders();
    let systemPrompt = "You have access to the following skills:\n\n";
    for (let index = 0; index < skills.length; index++) {
      const element = skills[index];
      skillNames.push(element.name.trim());
      const entry =
        element.name.trim() + ": " + element.description.trim() + "\n";
      systemPrompt = systemPrompt.concat(entry);
    }
    return systemPrompt;
  };
  let message: ChatCompletionMessageParam[] = [
    { role: "system", content: await advertiseSkills() },
  ];

  const agumentedSkillwithArgs = async <T extends { ARGUMENTS?: string }>(
    skill: string,
    argnt: T,
  ) => {
    const { ARGUMENTS = "" } = argnt;

    let data = await loadSkill(skill);
    const keys = Object.keys(argnt) as Array<keyof T>;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (Object.hasOwn(argnt, key)) {
        const value = String(argnt[key] ?? "");
        data = data.replaceAll(`$${String(key)}`, value);
      }
    }
    return data;
  };

  //what we will have to do will be to first check which skills are there, so we can first, split on whitespace, then for loop with condition being that it is starting with / and the other condition is that the skill,exists wherever it stops we will start creating the args from there.
  const skillsInvoked: string[] = [];
  let argsToLoad: any = {};
  const findSkillsCalled = (splittedPrompt: string[]) => {
    for (let index = 0; index < splittedPrompt.length; index++) {
      const element = splittedPrompt[index];
      if (!element.startsWith("/")) return index;
      if (!skillNames.includes(element.slice(1))) return index;
      skillsInvoked.push(element.slice(1));
    }
    return splittedPrompt.length;
  };

  const BuildArgs = () => {
    const splitedPrompt = prompt.split(" ");
    const index = findSkillsCalled(splitedPrompt);
    let ARGUMENTS = "";
    for (let i = index; i < splitedPrompt.length; i++) {
      argsToLoad[String(i - 1)] = splitedPrompt[i];
      ARGUMENTS += splitedPrompt[i] + " ";
    }
    ARGUMENTS = ARGUMENTS.trim();
    argsToLoad = { ...argsToLoad, ARGUMENTS };
  };
  BuildArgs();

  if (skillsInvoked.length != 0) {
    for (let index = 0; index < skillsInvoked.length; index++) {
      const element = skillsInvoked[index];
      message.push({
        role: "user",
        content: await agumentedSkillwithArgs(element, argsToLoad),
      });
    }
  } else {
    message.push({ role: "user", content: prompt });
  }

  // if (prompt.startsWith("/")) {
  //   const firstSpaceIndex = prompt.indexOf(" ");

  //   const skill =
  //     firstSpaceIndex === -1
  //       ? prompt.slice(1)
  //       : prompt.slice(1, firstSpaceIndex);

  //   console.error(skill);
  //   console.error(skillNames);
  //   if (skillNames.includes(skill)) {
  //     message.push({
  //       role: "user",
  //       content: await agumentedSkillwithArgs(skill, BuildArgs()),
  //     });
  //   } else {
  //     message.push({ role: "user", content: prompt });
  //   }
  // } else {
  //   message.push({ role: "user", content: prompt });
  // }
  console.error(message);
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
        {
          type: "function",
          function: {
            name: "Write",
            description: "Write content to a file",
            parameters: {
              type: "object",
              properties: {
                file_path: {
                  type: "string",
                  description: "The path to the file to write",
                },
                content: {
                  type: "string",
                  description: "The content to write to the file",
                },
              },
              required: ["file_path", "content"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "Bash",
            description: "Perform Bash Call",
            parameters: {
              type: "object",
              required: ["command"],
              properties: {
                command: {
                  type: "string",
                  description: "The command to execute through the bash call",
                },
              },
            },
          },
        },
      ],
    });
    message.push({
      role: "assistant",
      content: response.choices[0].message.content,
      tool_calls: response.choices[0].message.tool_calls,
    });

    console.error(response.choices[0]);
    const tool_calls = response.choices[0].message.tool_calls;
    if (!tool_calls || tool_calls.length == 0) {
      console.log(response.choices[0].message.content);
      break;
    }
    for (let index = 0; index < tool_calls.length; index++) {
      const element = tool_calls[index];
      if (element.type == "function") {
        const toolToCall = tools[element.function.name];
        if (toolToCall) {
          const params = JSON.parse(element.function.arguments);
          const result = await toolToCall(params);
          message.push({
            role: "tool",
            tool_call_id: element.id,
            content: result,
          });
        }
      }
    }
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
