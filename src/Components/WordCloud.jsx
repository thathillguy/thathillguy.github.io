import React from 'react';
import Word from './Word';
import '../Styles/Components.less';

export default class Chart extends React.Component {

    constructor(props){
        super(props);
    }
    render() {
        return (
            <div className="wordCloud">
            {
                this.props.words.map((word, id) => {
                    const style = {};
                    return <Word className='word' style={style} word={word}
                          quantity={this.props.dictionary[word]} key={id} />
                })
            }
            </div>
        )
    }
}