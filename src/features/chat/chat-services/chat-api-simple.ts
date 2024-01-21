import { userHashedId } from "@/features/auth/helpers";
import { OpenAIInstance } from "@/features/common/openai";
import { AI_NAME } from "@/features/theme/customise";
import { OpenAIStream, StreamingTextResponse } from "ai";
import { initAndGuardChatSession } from "./chat-thread-service";
import { CosmosDBChatMessageHistory } from "./cosmosdb/cosmosdb";
import { PromptGPTProps } from "./models";

export const ChatAPISimple = async (props: PromptGPTProps) => {
  const { lastHumanMessage, chatThread } = await initAndGuardChatSession(props);

  const openAI = OpenAIInstance();

  const userId = await userHashedId();

  const chatHistory = new CosmosDBChatMessageHistory({
    sessionId: chatThread.id,
    userId: userId,
  });

  await chatHistory.addMessage({
    content: lastHumanMessage.content,
    role: "user",
  });

  const history = await chatHistory.getMessages();
  const topHistory = history.slice(history.length - 30, history.length);

  try {
    
    // Set headers for bing search api
    let headersList = {
      "Ocp-Apim-Subscription-Key": process.env.AZURE_BING_SEARCH_API_KEY || "",
      "mkt": "he-IL"
    }

    // Call bing search api
    let bing_response = await fetch(process.env.AZURE_BING_SEARCH_ENDPOINT+"/v7.0/search?q=" + lastHumanMessage.content, {
      method: "GET",
      headers: headersList
    });

    // Convert bing response to text
    let data = await bing_response.text();

    // convert webpages to json object
    const webpagesResponse = JSON.parse(data);

    // Create an array to store custom object list (name, url, content)
    const resultsPrompts = [];

    // Check if webpages is not empty
    if (webpagesResponse.webPages.value.length > 0) {
      // Iterate through each webpage and get the snippet
      for (const webpage of webpagesResponse.webPages.value) {
        resultsPrompts.push(`name: ${webpage.name}\nurl: ${webpage.url}\ncontent: ${webpage.snippet}`);
        break
      }
    }

    const response = await openAI.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `-You are ${AI_NAME} who is a helpful AI Assistant.
          - You will provide clear and concise queries, and you will respond with polite and professional answers.
          - You will answer questions truthfully and accurately.
          - Use the following sources to answer the question, 
            If the information provided to you contains information that is not 
            relevant to the user's question, do not convey this information in
            your answer but only information that is relevant to the user's question,
            here are the sources of the information {${resultsPrompts.join("\n")}}}`,
        },
        ...topHistory,
      ],
      model: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
      stream: true,
    });

    const stream = OpenAIStream(response, {
      async onCompletion(completion) {
        await chatHistory.addMessage({
          content: completion,
          role: "assistant",
        });
      },
    });
    return new StreamingTextResponse(stream);
  } catch (e: unknown) {
    if (e instanceof Error) {
      return new Response(e.message, {
        status: 500,
        statusText: e.toString(),
      });
    } else {
      return new Response("An unknown error occurred.", {
        status: 500,
        statusText: "Unknown Error",
      });
    }
  }
};
