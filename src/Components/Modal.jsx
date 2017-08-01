import React, { Component, PropTypes } from 'react';
import '../Styles/Project.less';


export default class Modal extends React.Component{
    render() {
        var widget = this;
        if (this.props.active) {
            return(
                <div className="modal">
                    {widget.props.children}
                </div>
            );
        } else {
            return(
                null
            );
        }
    }
}