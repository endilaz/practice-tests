import { useState } from 'react'
import { TopicsAdmin } from '@/topics/TopicsAdmin'
import QuestionsAdmin from '@/questions/QuestionsAdmin'
import QuestionAnalytics from '@/analytics/QuestionAnalytics'
import UserAnalytics from '@/analytics/UserAnalytics'

type Tab = 'topics' | 'questions' | 'analytics'

export default function Admin() {
  const [activeTab, setActiveTab] = useState<Tab>('topics')
  const [analyticsView, setAnalyticsView] = useState<'questions' | 'users'>('questions')

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <h1 className="text-2xl font-bold text-gray-900">Admin Panel</h1>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex space-x-8">
            <button
              onClick={() => setActiveTab('topics')}
              className={[
                'py-4 px-1 border-b-2 font-medium text-sm transition-colors',
                activeTab === 'topics'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
              ].join(' ')}
            >
              Topics
            </button>
            <button
              onClick={() => setActiveTab('questions')}
              className={[
                'py-4 px-1 border-b-2 font-medium text-sm transition-colors',
                activeTab === 'questions'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
              ].join(' ')}
            >
              Questions
            </button>
            <button
              onClick={() => setActiveTab('analytics')}
              className={[
                'py-4 px-1 border-b-2 font-medium text-sm transition-colors',
                activeTab === 'analytics'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
              ].join(' ')}
            >
              Analytics
            </button>
          </nav>
        </div>
      </div>

      {/* Tab Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'topics' && <TopicsAdmin />}
        {activeTab === 'questions' && <QuestionsAdmin />}
        {activeTab === 'analytics' && (
          <div className="space-y-6">
            {/* Analytics Sub-tabs */}
            <div className="flex gap-4 border-b border-gray-200 pb-4">
              <button
                onClick={() => setAnalyticsView('questions')}
                className={[
                  'px-4 py-2 rounded-lg font-medium text-sm transition-colors',
                  analyticsView === 'questions'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200',
                ].join(' ')}
              >
                Question Analytics
              </button>
              <button
                onClick={() => setAnalyticsView('users')}
                className={[
                  'px-4 py-2 rounded-lg font-medium text-sm transition-colors',
                  analyticsView === 'users'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200',
                ].join(' ')}
              >
                User Analytics
              </button>
            </div>

            {/* Analytics Content */}
            {analyticsView === 'questions' && <QuestionAnalytics />}
            {analyticsView === 'users' && <UserAnalytics />}
          </div>
        )}
      </div>
    </div>
  )
}