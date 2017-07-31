import React from 'react';
import '../Styles/Project.less';


export default class ContactForm extends React.Component {
    constructor(props) {
        super(props);
    }
    render() {
        return(
            <div>
                <input type="text" name="name" />
                <input type="text" name="name" />
                <input type="text" name="name" />
                <div type="submit" value="Submit" />
             </div>
        )
    }
}
