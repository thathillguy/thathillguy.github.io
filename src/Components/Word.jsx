import React from 'react';
import '../Styles/Components.less';

export default class Chart extends React.Component {

    constructor(props){
        super(props);
    }
    render() {
        let style = this.props.style;
        style['fontSize'] = this.props.quantity * 10 + 'px';
        return (
                <h style={style}> {this.props.word} </h>
        )
    }
}