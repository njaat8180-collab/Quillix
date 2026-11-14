import type {ToolCall} from '../shared/types.js';
import {extractToolCallsFromText} from './toolCallParser.js';

/** Keeps provider text in Chat. Only explicit, registered tool envelopes are actionable. */
export class ChatResponseRouter {
  constructor(private readonly knownTools:Set<string>) {}
  route(text:string,nativeToolCalls:ToolCall[]=[]): {chatText:string;toolCalls:ToolCall[]} {
    const parsed=extractToolCallsFromText(text,this.knownTools);
    return {chatText:parsed.cleanedText.trim(),toolCalls:[...nativeToolCalls,...parsed.calls]};
  }
}
