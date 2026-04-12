import { useState } from 'react'
import { supabase } from '@/lib/supabase'

type GenerateTestParams = {
  topicId: string
  questionCount: number
  useTimer: boolean
  minutes: number
}

export function useGenerateTest() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generateTest(params: GenerateTestParams): Promise<string | null> {
    setLoading(true)
    setError(null)

    const { data, error: rpcError } = await supabase.rpc('generate_test', {
      p_topic_id: params.topicId,
      p_question_count: params.questionCount,
      p_use_timer: params.useTimer,
      p_minutes: params.minutes,
    })

    if (rpcError) {
      setError(rpcError.message)
      setLoading(false)
      return null
    }

    setLoading(false)
    return data as string // The function returns uuid
  }

  return { generateTest, loading, error }
}