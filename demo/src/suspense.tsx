import { render, lazy, Suspense, h } from '../../src/index'

const Lazy = lazy(() => {
  return new Promise(resolve =>
    setTimeout(
      () =>
        resolve({
          default: () => <div>Hello</div>
        }),
      1000
    )
  )
})

function App() {
  return <div>
    <Suspense fallback={'loading'}>
      <h1>
        <Lazy />
      </h1>
      <Suspense fallback={'loading'}>
        <Lazy />
      </Suspense>

      <div>222</div>
      <Lazy />
      <div>111</div>
    </Suspense>
  </div>
}

render(<App />, document.getElementById('app'))