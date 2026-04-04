import { useState, useEffect } from 'react'

interface DiffData {
  patch: string
  repoName: string
}

export function useDiff() {
  const [data, setData] = useState<DiffData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const staged = params.get('staged') === 'true'

    fetch(`/api/diff?staged=${staged}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((json) => setData(json))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  return {
    patch: data?.patch ?? null,
    repoName: data?.repoName ?? '',
    loading,
    error,
  }
}
