import Link from 'next/link';

export default function BillingSuccessPage() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center max-w-md">
        <div className="text-5xl mb-4">🎉</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">You&apos;re all set!</h1>
        <p className="text-gray-500 mb-8">
          Your subscription is active. LeakLock is now protecting your revenue.
        </p>
        <Link
          href="/jobs"
          className="inline-block px-6 py-3 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}
