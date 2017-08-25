import React from 'react';
import Word from './Word';
import '../Styles/Components.less';

export default class Chart extends React.Component {

    constructor(props){
        super(props);
        this.dictionary = this.props.dictionary;
    }
    render() {
        return (
            <div className="wordCloud">
            {
                this.dictionary.map((entry, id) => {
                    const style = {};
                    return (
                        <Word
                            className='word'
                            style={style}
                            word={entry.key}
                            quantity={entry.val} key={id}
                        />
                    )
                })
            }
            </div>
        )
    }
}