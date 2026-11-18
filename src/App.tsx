import CaptureView from './views/CaptureView'
import MainView from './views/MainView'

export default function App() {
  const isCapture = window.location.hash.startsWith('#/capture')
  return isCapture ? <CaptureView /> : <MainView />
}
