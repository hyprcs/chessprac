import { render } from 'preact';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';
import './styles.css';
import { init } from './state';
import { startAnalysis } from './analysis';
import { App } from './ui/App';

render(<App />, document.getElementById('app')!);
void init().then(startAnalysis);
