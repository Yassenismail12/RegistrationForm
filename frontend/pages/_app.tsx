// Next.js custom app entrypoint with an error boundary for production resilience
import Head from 'next/head';
import type { AppProps } from 'next/app';
import { Component, ErrorInfo, ReactNode } from 'react';
import '../components/RegistrationForm.css';

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(JSON.stringify({ event: 'client_error', error: error.message, info }));
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <h1>حدث خطأ ما</h1>
          <p>يرجى إعادة تحميل الصفحة أو المحاولة لاحقًا.</p>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function MyApp({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Beiruti:wght@200..900&family=Playpen+Sans+Arabic:wght@100..800&display=swap"
          rel="stylesheet"
        />
        <script
  src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
  async
  defer
/>
      </Head>
      <ErrorBoundary>
        <Component {...pageProps} />
      </ErrorBoundary>
    </>
  );
}
