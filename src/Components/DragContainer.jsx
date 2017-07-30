import React from 'react';
import Paper from 'material-ui/Paper';
import '../Styles/Project.less';

import FlatButton from 'material-ui/FlatButton';
import Divider from 'material-ui/Divider';

import Modal from './Modal.jsx';


export default class Project extends React.Component {
    constructor(props){
        super(props);
    }

    render() {
        return (
            this.props.children
        )
    }
}