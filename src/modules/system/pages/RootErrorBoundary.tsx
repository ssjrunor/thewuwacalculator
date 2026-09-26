/*
  Author: Runor Ewhro
  Description: Keeps provider and router initialization errors visible even
               when they occur outside React Router's route boundaries.
*/

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { StartupErrorNotice } from './StartupErrorNotice'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class RootErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App render failed:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <StartupErrorNotice error={this.state.error} heading="The app stopped working." />
      )
    }
    return this.props.children
  }
}
