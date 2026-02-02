import { Link } from 'react-router-dom'
import { TopicsAdmin } from '@/topics/TopicsAdmin'

export default function Admin() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow px-4 py-3 flex justify-between items-center">
        <h1 className="text-lg font-semibold">Admin Panel</h1>
        <Link to="/" className="text-sm text-blue-600 underline">
          Back to Dashboard
        </Link>
      </header>

      <main className="max-w-lg mx-auto mt-10 px-4">
        <h2 className="text-xl font-bold mb-6">Topics</h2>
        <TopicsAdmin />
      </main>
    </div>
  )
}