import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { createLogger } from '../logging/logger'

const logger = createLogger('ErrorBoundary')

interface ErrorBoundaryProps {
  children: ReactNode
  /** Shown in the fallback message, e.g. "the spatial editor". */
  label?: string
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error('Unhandled render error:', error, errorInfo)
  }

  handleRetry = () => {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) {
      return this.props.children
    }

    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center gap-3 bg-rose-50 p-6 text-center text-rose-900"
        role="alert"
      >
        <AlertTriangle className="size-8 text-rose-600" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold">
            {this.props.label ? `Something went wrong in ${this.props.label}.` : 'Something went wrong.'}
          </p>
          <p className="mt-1 text-sm opacity-80">{error.message}</p>
        </div>
        <button
          type="button"
          onClick={this.handleRetry}
          className="rounded-md border border-rose-300 bg-white px-3 py-1.5 text-sm font-medium text-rose-700 transition hover:bg-rose-100 focus:outline-none focus:ring-2 focus:ring-rose-500"
        >
          Try again
        </button>
      </div>
    )
  }
}
