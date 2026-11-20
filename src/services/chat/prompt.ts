import type { CreateMessageRequest } from '../api/types.js'

/** 所有生成请求统一携带的助手身份说明 */
export const SYSTEM_PROMPT = '该助手为DeepSeek，由深度求索公司创造。'

/** 阅读链接始终开启，智能搜索开关控制是否另行声明搜索工具（含边想边搜）。 */
export const serverTools = (search: boolean): CreateMessageRequest['tools'] => {
  const tools: CreateMessageRequest['tools'] = [
    { type: 'deepseek_read_url', name: 'deepseek_read_url' },
  ]
  if (search) {
    tools.push({ type: 'deepseek_web_search', name: 'deepseek_web_search' })
  }
  return tools
}
