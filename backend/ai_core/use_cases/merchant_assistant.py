import json
import logging
import re
import time

from ..gateway.ai_gateway import get_gateway
from ..prompts.registry import prompt_registry
from ..contracts.chat import ChatRequest, ChatMessage, ToolDefinition
from ..models import AIConversation, AIConversationMessage, AIRequest
from ..constants import REQUEST_STATUS_COMPLETED, REQUEST_STATUS_FAILED
from ..exceptions import AIProviderRateLimited
from ..tools.registry import tool_registry
from ..tools.guidance_tools import register_guidance_tools

logger = logging.getLogger(__name__)


def chat_with_merchant_assistant(
    merchant, user, conversation: AIConversation,
    message_content: str,
) -> dict:
    register_guidance_tools()
    prompt_def = prompt_registry.get("merchant_assistant", "1.0.0")
    system_prompt = prompt_def["system_prompt"]

    history_messages = list(
        conversation.messages
        .filter(role__in=["user", "assistant"])
        .order_by("created_at")
    )[-20:]

    chat_messages = []
    for msg in history_messages:
        chat_messages.append(ChatMessage(role=msg.role, content=msg.content))
    chat_messages.append(ChatMessage(role="user", content=message_content))

    tools_list = tool_registry.list_definitions()
    tool_defs = []
    if tools_list:
        for t in tools_list:
            tool_defs.append(ToolDefinition(
                name=t["name"],
                description=t["description"],
                parameters=t["parameters"],
            ))

    gateway = get_gateway()
    req = ChatRequest(
        system_prompt=system_prompt,
        messages=chat_messages,
        tools=tool_defs if tool_defs else None,
        temperature=0.3,
    )

    ai_request = AIRequest.objects.create(
        merchant=merchant,
        user=user,
        use_case="merchant_assistant",
        model_alias="fast-chat",
        status=REQUEST_STATUS_COMPLETED,
    )

    user_msg = AIConversationMessage.objects.create(
        conversation=conversation,
        role="user",
        content=message_content,
        ai_request=ai_request,
    )

    try:
        max_tool_rounds = 5
        current_messages = list(chat_messages)
        final_content = ""
        total_input_tokens = 0
        total_output_tokens = 0

        has_used_tool = False
        is_greeting = message_content.strip().lower().rstrip("!.,") in {"hi", "hello", "hey", "heyy", "heya", "howdy", "greetings", "sup", "yo", "good morning", "good afternoon", "good evening", "whats up", "wassup"}

        for _round in range(max_tool_rounds):
            tc = "required" if _round == 0 and tool_defs and not has_used_tool and not is_greeting else None
            round_tools = None if (is_greeting and not has_used_tool) else (tool_defs if tool_defs else None)
            req = ChatRequest(
                system_prompt=system_prompt,
                messages=current_messages,
                tools=round_tools,
                temperature=0.3,
                tool_choice=tc if round_tools else None,
            )

            try:
                result = gateway.chat(
                    model_alias="fast-chat",
                    request=req,
                )
            except AIProviderRateLimited as e:
                match = re.search(r"try again in ([\d.]+)s", str(e))
                wait = float(match.group(1)) + 0.5 if match else 1.0
                time.sleep(wait)
                result = gateway.chat(
                    model_alias="fast-chat",
                    request=req,
                )

            total_input_tokens += result.input_tokens or 0
            total_output_tokens += result.output_tokens or 0

            ai_request.provider = result.provider
            ai_request.provider_model = result.model
            ai_request.input_tokens = total_input_tokens
            ai_request.output_tokens = total_output_tokens
            ai_request.total_tokens = total_input_tokens + total_output_tokens
            ai_request.latency_ms = (ai_request.latency_ms or 0) + result.latency_ms

            if not result.tool_calls:
                if not has_used_tool and tool_defs and _round <= 1 and not is_greeting:
                    current_messages.append(ChatMessage(
                        role="user",
                        content="You must use one of the available tools to fetch real data before answering. Please call the appropriate function.",
                    ))
                    continue
                current_messages.append(ChatMessage(
                    role=result.message.role, content=result.message.content,
                ))
                final_content = result.message.content
                break

            has_used_tool = True
            final_content = result.message.content

            current_messages.append(ChatMessage(
                role=result.message.role,
                content=result.message.content,
                tool_calls=[
                    {"id": tc.id, "type": "function", "function": {"name": tc.name, "arguments": json.dumps(tc.arguments)}}
                    for tc in result.tool_calls
                ],
            ))

            for tc in result.tool_calls:
                tool_content = tool_registry.execute(tc.name, merchant, tc.arguments)

                current_messages.append(ChatMessage(
                    role="tool",
                    content=tool_content,
                    tool_call_id=tc.id,
                    name=tc.name,
                ))

        ai_request.save(update_fields=[
            "provider", "provider_model", "input_tokens",
            "output_tokens", "total_tokens", "latency_ms",
        ])

        assistant_msg = AIConversationMessage.objects.create(
            conversation=conversation,
            role="assistant",
            content=final_content,
            input_tokens=total_input_tokens,
            output_tokens=total_output_tokens,
            ai_request=ai_request,
        )

        return {
            "message_id": str(assistant_msg.id),
            "content": final_content,
            "request_id": str(ai_request.id),
            "tokens": total_input_tokens + total_output_tokens,
        }

    except Exception as e:
        logger.exception("Merchant assistant chat failed")
        ai_request.status = REQUEST_STATUS_FAILED
        ai_request.error_code = "chat_failed"
        ai_request.sanitized_error = str(e)[:500]
        ai_request.save(update_fields=["status", "error_code", "sanitized_error"])

        assistant_msg = AIConversationMessage.objects.create(
            conversation=conversation,
            role="assistant",
            content="I'm sorry, I encountered an error processing your request. Please try again.",
            ai_request=ai_request,
        )

        return {
            "message_id": str(assistant_msg.id),
            "content": assistant_msg.content,
            "request_id": str(ai_request.id),
            "error": str(e)[:200],
        }
